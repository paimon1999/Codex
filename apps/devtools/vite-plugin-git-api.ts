import type { Plugin, ViteDevServer } from 'vite';
import { execSync } from 'child_process';
import path from 'path';

// 默认扫描的 Git 仓库路径
const DEFAULT_REPO_PATH = process.env.GIT_REPO_PATH || '/Users/paimon/Rustrover/Codex';

// 排除的文件模式
const EXCLUDE_PATTERNS = [
  'node_modules/',
  '.workbuddy/',
  'package-lock.json',
  'target/',
  'dist/',
  '.git/',
];

// 自定义修改的 fork 点（上游分叉点）
const FORK_BASE = '151b36e';

// 功能分类映射
const FEATURE_MAP: Record<string, string[]> = {
  'proxy_stats.rs': ['流量统计'],
  'stats_persistence.rs': ['流量统计'],
  'launcher.rs': ['流量统计', '端口冲突修复', '无调试端口修复'],
  'commands.rs': ['流量统计', '启动验证', '进程管理'],
  'lib.rs': ['命令注册'],
  'App.tsx': ['流量统计UI', '进程管理UI'],
  'styles.css': ['UI样式'],
  'renderer-inject.js': ['模型名称注入', '状态指示器'],
  'config_manager.rs': ['配置管理修复'],
  'package.json': ['前端依赖'],
  'Cargo.toml': ['Rust依赖'],
};

// 功能 → 描述
const FEATURE_DESCRIPTIONS: Record<string, string> = {
  '流量统计': 'MiMo Credits 定价逻辑、cached_tokens 兼容、统计快照扩展',
  '流量统计UI': 'Chart.js 图表、历史趋势、缓存细分、自动刷新控制',
  '进程管理': '进程列表、CPU/内存监控、端口冲突检测、一键清理',
  '进程管理UI': '进程管理页面、实时刷新、调试输出面板',
  '模型名称注入': 'MutationObserver 替换"自定义"为模型名称',
  '状态指示器': '右下角红绿灯指示注入状态',
  '启动验证': '启动后 800ms 检查进程存活、stderr 捕获',
  '端口冲突修复': 'AddrInUse 时检查已有 Helper、跳过重复启动',
  '无调试端口修复': 'Codex 运行但 CDP 不可用时先 quit 再重启',
  '配置管理修复': 'MCP 服务器配置写入 table_mut_or_insert',
  '命令注册': '注册新 Tauri 命令',
  'UI样式': '表格样式、metric-list 网格布局',
  '前端依赖': 'chart.js + react-chartjs-2',
  'Rust依赖': 'tokio.workspace = true',
};

// 上游已删除的文件
const UPSTREAM_DELETED_FILES = new Set([
  'crates/ucodex-core/src/proxy_stats.rs',
  'crates/ucodex-core/src/stats_persistence.rs',
  'crates/ucodex-core/src/config_manager.rs',
]);

interface FileChange {
  path: string;
  status: string;
  added: number;
  removed: number;
  staged: boolean;
  diff?: string;
}

interface GitInfo {
  currentBranch: string;
  latestCommit: string;
  latestCommitMsg: string;
  remoteUrl: string;
  repoPath: string;
}

// 执行 git 命令的辅助函数
function gitExec(args: string, repoPath: string, timeoutMs = 30000): string {
  try {
    return execSync(`git ${args}`, { cwd: repoPath, encoding: 'utf-8', timeout: timeoutMs }).trim();
  } catch (error: any) {
    return '';
  }
}

// 带详细错误信息的 git 命令执行
function gitExecWithDetails(args: string, repoPath: string, timeoutMs = 15000): { ok: boolean; output: string; error?: string; rawStderr?: string } {
  try {
    const output = execSync(`git ${args}`, { cwd: repoPath, encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ok: true, output };
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    const isTimeout = error.killed || error.signal === 'SIGTERM';
    let errorMsg = '';

    if (isTimeout) {
      errorMsg = `命令超时（${timeoutMs / 1000}秒）：git ${args}`;
    } else if (stderr.includes('502') || stderr.includes('CONNECT tunnel failed')) {
      errorMsg = `代理连接失败（HTTP 502）：git ${args}`;
    } else if (stderr.includes('Could not resolve host')) {
      errorMsg = `DNS 解析失败：git ${args}`;
    } else if (stderr.includes('Connection refused') || stderr.includes('Connection timed out')) {
      errorMsg = `网络连接失败：git ${args}`;
    } else if (stderr.includes('fatal:')) {
      const match = stderr.match(/fatal:\s*(.+)/);
      errorMsg = match ? match[1] : `git ${args} 失败`;
    } else {
      errorMsg = `git ${args} 失败：${stderr || error.message}`;
    }

    return {
      ok: false,
      output: '',
      error: errorMsg,
      rawStderr: stderr,
    };
  }
}

export default function gitApiPlugin(repoPath?: string): Plugin {
  const gitRepoPath = repoPath || DEFAULT_REPO_PATH;

  return {
    name: 'vite-plugin-git-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = url.pathname;

        // 设置 CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        // API 路由
        if (pathname.startsWith('/api/git/')) {
          res.setHeader('Content-Type', 'application/json');

          try {
            if (pathname === '/api/git/info') {
              const info = getGitInfo();
              res.end(JSON.stringify(info));
            } else if (pathname === '/api/git/changes') {
              const changes = getChanges();
              res.end(JSON.stringify(changes));
            } else if (pathname === '/api/git/diff') {
              const file = url.searchParams.get('file');
              const base = url.searchParams.get('base') || 'HEAD';
              if (!file) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'file parameter required' }));
                return;
              }
              const diff = getFileDiff(file, base);
              res.end(JSON.stringify({ diff }));
            } else if (pathname === '/api/git/branches') {
              const branches = getBranches();
              res.end(JSON.stringify(branches));
            } else if (pathname === '/api/git/log') {
              const limit = parseInt(url.searchParams.get('limit') || '50');
              const log = getLog(limit);
              res.end(JSON.stringify(log));
            } else if (pathname === '/api/git/status') {
              const status = getStatus();
              res.end(JSON.stringify(status));
            } else if (pathname === '/api/git/upstream-diff') {
              const base = url.searchParams.get('base') || '';
              const head = url.searchParams.get('head') || 'FETCH_HEAD';
              if (!base) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'base parameter required' }));
                return;
              }
              const diff = getUpstreamDiff(base, head);
              res.end(JSON.stringify(diff));
            } else if (pathname === '/api/git/fetch-upstream' && req.method === 'POST') {
              // Fetch 上游，带超时
              const remoteName = url.searchParams.get('remote') || 'upstream';
              const branch = url.searchParams.get('branch') || 'main';
              const result = gitExecWithDetails(`fetch ${remoteName} ${branch}`, gitRepoPath, 15000);
              if (result.ok) {
                res.end(JSON.stringify({ success: true }));
              } else {
                res.end(JSON.stringify({ success: false, error: result.error }));
              }
            } else if (pathname === '/api/git/upstream-config') {
              // 获取上游配置
              const remotes = gitExec('remote -v', gitRepoPath);
              const remoteList = remotes.split('\n').filter(Boolean).map(line => {
                const parts = line.split('\t');
                return { name: parts[0], url: parts[1]?.replace(/ \(.*\)/, '') || '', type: line.includes('(fetch)') ? 'fetch' : 'push' };
              }).filter(r => r.type === 'fetch');

              // 获取 upstream remote URL
              const upstreamUrl = gitExec('remote get-url upstream 2>/dev/null', gitRepoPath);
              res.end(JSON.stringify({
                remotes: remoteList,
                upstreamUrl,
                hasUpstream: !!upstreamUrl,
              }));
            } else if (pathname === '/api/git/set-upstream' && req.method === 'POST') {
              // 设置上游仓库 URL
              const body = await new Promise<string>((resolve) => {
                let data = '';
                req.on('data', (chunk) => data += chunk);
                req.on('end', () => resolve(data));
              });
              try {
                const { url: upstreamUrl } = JSON.parse(body);
                if (!upstreamUrl) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'url is required' }));
                  return;
                }
                // 检查是否已有 upstream remote
                const existing = gitExec('remote get-url upstream 2>/dev/null', gitRepoPath);
                if (existing) {
                  gitExec(`remote set-url upstream "${upstreamUrl}"`, gitRepoPath);
                } else {
                  gitExec(`remote add upstream "${upstreamUrl}"`, gitRepoPath);
                }
                res.end(JSON.stringify({ success: true, url: upstreamUrl }));
              } catch (error: any) {
                res.end(JSON.stringify({ success: false, error: error.message }));
              }
            } else if (pathname === '/api/git/custom-changes') {
              // 获取自定义修改（fork 点到 HEAD 之间的提交差异）
              const base = url.searchParams.get('base') || FORK_BASE;
              const head = url.searchParams.get('head') || 'HEAD';
              const changes = getCustomChanges(base, head);
              res.end(JSON.stringify(changes));
            } else if (pathname === '/api/git/custom-diff') {
              // 获取指定文件的自定义修改 diff
              const file = url.searchParams.get('file');
              const base = url.searchParams.get('base') || FORK_BASE;
              const head = url.searchParams.get('head') || 'HEAD';
              if (!file) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'file parameter required' }));
                return;
              }
              const diff = getCustomFileDiff(file, base, head);
              res.end(JSON.stringify({ diff }));
            } else if (pathname === '/api/git/upstream-analysis') {
              // 获取上游分析
              const base = url.searchParams.get('base') || FORK_BASE;
              const skipFetch = url.searchParams.get('skipFetch') === 'true';
              let fetchError: string | null = null;

              // 检查是否有 upstream remote
              const hasUpstream = !!gitExec('remote get-url upstream 2>/dev/null', gitRepoPath);
              if (!hasUpstream) {
                res.end(JSON.stringify({
                  error: '未配置上游仓库',
                  errorCode: 'NO_UPSTREAM',
                  help: '请先在设置中配置上游仓库地址（如 https://github.com/BigPizzaV3/CodexPlusPlus.git）',
                }));
                return;
              }

              // 可选：先 fetch upstream
              if (!skipFetch) {
                const fetchResult = gitExecWithDetails('fetch upstream', gitRepoPath, 15000);
                if (!fetchResult.ok) {
                  fetchError = fetchResult.error || 'fetch 失败';
                  // 补充网络错误诊断
                  if (fetchResult.rawStderr?.includes('502')) {
                    fetchError += '\n\n💡 诊断：代理服务器返回 502 错误。请检查：\n• 是否需要配置代理（git config --global http.proxy）\n• VPN 是否正常连接\n• GitHub 是否被网络限制';
                  } else if (fetchResult.rawStderr?.includes('Could not resolve host')) {
                    fetchError += '\n\n💡 诊断：DNS 解析失败。请检查：\n• 网络连接是否正常\n• 是否需要配置 DNS 或代理';
                  }
                  // fetch 失败不阻塞，尝试用已有 FETCH_HEAD
                }
              }

              // 获取 FETCH_HEAD 或 upstream/main 的 commit
              let fetchHead = gitExec('rev-parse FETCH_HEAD 2>/dev/null', gitRepoPath);
              if (!fetchHead) {
                // 尝试 upstream/main 或 upstream/master
                fetchHead = gitExec('rev-parse upstream/main 2>/dev/null', gitRepoPath)
                  || gitExec('rev-parse upstream/master 2>/dev/null', gitRepoPath);
              }
              if (!fetchHead) {
                res.end(JSON.stringify({
                  error: '没有可用的上游数据',
                  errorCode: 'NO_FETCH_HEAD',
                  fetchError,
                  help: fetchError
                    ? `Fetch 上游失败：${fetchError}\n\n建议：\n1. 检查网络连接和代理设置\n2. 确认上游仓库 URL 是否正确\n3. 尝试手动运行：git fetch upstream\n4. 如果网络受限，可以配置代理：git config --global http.proxy http://127.0.0.1:7890`
                    : '请先 fetch 上游代码，或使用"跳过 Fetch"模式查看已有的缓存数据。\n\n如果从未 fetch 过上游，请先运行：\ngit fetch upstream',
                }));
                return;
              }

              const analysis = getUpstreamAnalysis(base, fetchHead);
              analysis.fetchError = fetchError;
              analysis.fetchSkipped = skipFetch;
              res.end(JSON.stringify(analysis));
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Not found' }));
            }
          } catch (error: any) {
            console.error('Git API error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message }));
          }
          return;
        }

        next();
      });
    }
  };

  // 获取 Git 仓库信息
  function getGitInfo(): GitInfo {
    const branch = gitExec('rev-parse --abbrev-ref HEAD', gitRepoPath) || 'unknown';
    const commit = gitExec('rev-parse --short HEAD', gitRepoPath) || 'unknown';
    const msg = gitExec('log -1 --pretty=format:%s', gitRepoPath) || '';
    // 尝试获取远程仓库 URL（可能没有 origin）
    let remote = '';
    try {
      remote = gitExec('remote get-url origin 2>/dev/null', gitRepoPath);
      if (!remote) {
        // 尝试获取第一个远程仓库
        const remotes = gitExec('remote', gitRepoPath);
        if (remotes) {
          const firstRemote = remotes.split('\n')[0];
          remote = gitExec(`remote get-url ${firstRemote} 2>/dev/null`, gitRepoPath);
        }
      }
    } catch (e) {
      remote = '';
    }

    return {
      currentBranch: branch,
      latestCommit: commit,
      latestCommitMsg: msg,
      remoteUrl: remote,
      repoPath: gitRepoPath,
    };
  }

  // 获取变更文件列表
  function getChanges(): FileChange[] {
    const changes: FileChange[] = [];

    // git status --porcelain
    const statusOutput = gitExec('status --porcelain', gitRepoPath);
    if (!statusOutput) return changes;

    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;
      const indexStatus = line[0];  // staged
      const workTreeStatus = line[1]; // working tree
      const filePath = line.substring(3).trim();

      if (isExcluded(filePath)) continue;

      let status = 'modified';
      let staged = false;

      if (indexStatus === 'A' || workTreeStatus === 'A') {
        status = 'added';
      } else if (indexStatus === 'D' || workTreeStatus === 'D') {
        status = 'deleted';
      } else if (indexStatus === 'R') {
        status = 'renamed';
      } else if (indexStatus === '??') {
        status = 'untracked';
      }

      // staged = index status is not space and not ?
      staged = indexStatus !== ' ' && indexStatus !== '?';

      // Get diff stats
      let added = 0;
      let removed = 0;

      if (status === 'untracked') {
        added = 0;
        removed = 0;
      } else if (staged) {
        const numstat = gitExec(`diff --cached --numstat -- "${filePath}"`, gitRepoPath);
        if (numstat) {
          const parts = numstat.split('\t');
          added = parseInt(parts[0]) || 0;
          removed = parseInt(parts[1]) || 0;
        }
      } else {
        const numstat = gitExec(`diff --numstat -- "${filePath}"`, gitRepoPath);
        if (numstat) {
          const parts = numstat.split('\t');
          added = parseInt(parts[0]) || 0;
          removed = parseInt(parts[1]) || 0;
        }
      }

      changes.push({
        path: filePath,
        status,
        added,
        removed,
        staged,
      });
    }

    return changes;
  }

  // 获取文件的完整 diff
  function getFileDiff(file: string, base: string): string {
    try {
      if (base === 'HEAD') {
        // 先检查是否 staged
        const stagedDiff = gitExec(`diff --cached -- "${file}"`, gitRepoPath);
        if (stagedDiff) return stagedDiff;

        // 再检查 working tree
        const workDiff = gitExec(`diff -- "${file}"`, gitRepoPath);
        if (workDiff) return workDiff;

        // 可能是 untracked 文件
        const isUntracked = gitExec(`ls-files --error-unmatch "${file}" 2>&1`, gitRepoPath);
        if (!isUntracked || isUntracked.includes('did not match')) {
          return '(新文件，暂无 diff)';
        }

        return '(无变更)';
      } else {
        const result = gitExec(`diff ${base} HEAD -- "${file}"`, gitRepoPath);
        return result || '(无变更)';
      }
    } catch (error: any) {
      return `(获取 diff 失败: ${error.message})`;
    }
  }

  // 获取分支列表
  function getBranches() {
    const output = gitExec('branch -a', gitRepoPath);
    const current = gitExec('rev-parse --abbrev-ref HEAD', gitRepoPath);
    const branches = output.split('\n')
      .filter(Boolean)
      .map(line => {
        const isCurrent = line.startsWith('*');
        const name = line.replace(/^\*\s*/, '').trim();
        return { name, current: isCurrent };
      });
    return { current, branches };
  }

  // 获取提交历史
  function getLog(limit: number) {
    const format = '%h|%s|%an|%aI';
    const output = gitExec(`log -${limit} --pretty=format:"${format}"`, gitRepoPath);
    if (!output) return [];

    return output.split('\n').filter(Boolean).map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash, message, author, date };
    });
  }

  // 获取仓库状态
  function getStatus() {
    const branch = gitExec('rev-parse --abbrev-ref HEAD', gitRepoPath) || 'unknown';
    const statusOutput = gitExec('status --porcelain', gitRepoPath) || '';
    const lines = statusOutput.split('\n').filter(Boolean);

    let staged = 0, modified = 0, not_added = 0, deleted = 0;
    for (const line of lines) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      if (indexStatus === '??') { not_added++; continue; }
      if (indexStatus !== ' ') staged++;
      if (workTreeStatus === 'M') modified++;
      if (workTreeStatus === 'D' || indexStatus === 'D') deleted++;
    }

    const ahead = parseInt(gitExec('rev-list --count @{u}..HEAD 2>/dev/null', gitRepoPath) || '0');
    const behind = parseInt(gitExec('rev-list --count HEAD..@{u} 2>/dev/null', gitRepoPath) || '0');

    return { currentBranch: branch, staged, modified, not_added, deleted, conflicted: 0, ahead, behind };
  }

  // 获取与上游的差异
  function getUpstreamDiff(base: string, head: string) {
    const fileList = gitExec(`diff --name-only ${base} ${head}`, gitRepoPath);
    const files = fileList.split('\n').filter(Boolean);

    const fileStats: Array<{ path: string; added: number; removed: number; status: string }> = [];

    for (const file of files) {
      if (isExcluded(file)) continue;

      const numstat = gitExec(`diff --numstat ${base} ${head} -- "${file}"`, gitRepoPath);
      let added = 0, removed = 0;
      if (numstat) {
        const parts = numstat.split('\t');
        added = parseInt(parts[0]) || 0;
        removed = parseInt(parts[1]) || 0;
      }

      // 判断文件状态
      let status = 'modified';
      const baseExists = gitExec(`cat-file -e ${base}:"${file}" 2>&1`, gitRepoPath);
      const headExists = gitExec(`cat-file -e ${head}:"${file}" 2>&1`, gitRepoPath);
      if (baseExists && !headExists) status = 'deleted';
      else if (!baseExists && headExists) status = 'added';

      fileStats.push({ path: file, added, removed, status });
    }

    const statSummary = gitExec(`diff --stat ${base} ${head}`, gitRepoPath);

    return {
      base: base.substring(0, 7),
      head: head.substring(0, 7),
      totalFiles: fileStats.length,
      totalAdded: fileStats.reduce((s, f) => s + f.added, 0),
      totalRemoved: fileStats.reduce((s, f) => s + f.removed, 0),
      files: fileStats,
      statSummary,
    };
  }

  // 获取自定义修改文件列表
  function getCustomChanges(base: string, head: string) {
    const fileList = gitExec(`diff --name-only ${base} ${head}`, gitRepoPath);
    const files = fileList.split('\n').filter(Boolean);

    const changes: Array<{
      path: string;
      added: number;
      removed: number;
      features: string[];
      description: string;
      conflictRisk: string;
      deletedUpstream: boolean;
      diff: string;
    }> = [];

    for (const file of files) {
      if (isExcluded(file)) continue;

      const numstat = gitExec(`diff --numstat ${base} ${head} -- "${file}"`, gitRepoPath);
      let added = 0, removed = 0;
      if (numstat) {
        const parts = numstat.split('\t');
        added = parseInt(parts[0]) || 0;
        removed = parseInt(parts[1]) || 0;
      }

      // 获取文件名中的关键词来匹配功能
      const fileName = file.split('/').pop() || '';
      const features: string[] = [];
      for (const [pattern, feats] of Object.entries(FEATURE_MAP)) {
        if (fileName.includes(pattern.replace('.rs', '').replace('.tsx', '').replace('.ts', '').replace('.js', '').replace('.css', ''))) {
          features.push(...feats);
        }
      }
      if (features.length === 0) {
        // 尝试用文件名直接匹配
        for (const [pattern, feats] of Object.entries(FEATURE_MAP)) {
          if (fileName === pattern || file.endsWith(pattern)) {
            features.push(...feats);
          }
        }
      }
      if (features.length === 0) {
        features.push('其他');
      }

      // 冲突风险
      const deletedUpstream = UPSTREAM_DELETED_FILES.has(file);
      let conflictRisk = 'low';
      if (deletedUpstream) conflictRisk = 'high';
      else if (added > 200) conflictRisk = 'high';
      else if (added > 50) conflictRisk = 'medium';

      // 描述
      const description = FEATURE_DESCRIPTIONS[features[0]] || file;

      // 获取摘要 diff（前 80 行）
      const fullDiff = gitExec(`diff ${base} ${head} -- "${file}"`, gitRepoPath);
      const diffLines = fullDiff.split('\n');
      const diff = diffLines.slice(0, 80).join('\n') + (diffLines.length > 80 ? '\n...' : '');

      changes.push({
        path: file,
        added,
        removed,
        features: [...new Set(features)],
        description,
        conflictRisk,
        deletedUpstream,
        diff,
      });
    }

    // 按 added 行数降序排序
    changes.sort((a, b) => b.added - a.added);

    return {
      base: base.substring(0, 7),
      head: head.substring(0, 7),
      totalFiles: changes.length,
      totalAdded: changes.reduce((s, c) => s + c.added, 0),
      totalRemoved: changes.reduce((s, c) => s + c.removed, 0),
      changes,
    };
  }

  // 获取自定义修改的文件 diff
  function getCustomFileDiff(file: string, base: string, head: string): string {
    try {
      const diff = gitExec(`diff ${base} ${head} -- "${file}"`, gitRepoPath);
      return diff || '(无变更)';
    } catch (error: any) {
      return `(获取 diff 失败: ${error.message})`;
    }
  }

  // 获取上游分析（你的提交 vs 上游最新）
  function getUpstreamAnalysis(base: string, fetchHead: string) {
    // 获取你的提交
    const myCommits = gitExec(`log --oneline ${base}..HEAD`, gitRepoPath)
      .split('\n').filter(Boolean).map(line => {
        const [hash, ...msgParts] = line.split(' ');
        return { hash, message: msgParts.join(' ') };
      });

    // 获取上游新提交
    const upstreamCommits = gitExec(`log --oneline HEAD..${fetchHead} 2>/dev/null`, gitRepoPath)
      .split('\n').filter(Boolean).map(line => {
        const [hash, ...msgParts] = line.split(' ');
        return { hash, message: msgParts.join(' ') };
      });

    // 获取上游文件变更统计
    const upstreamFiles = gitExec(`diff --name-only HEAD ${fetchHead} 2>/dev/null`, gitRepoPath)
      .split('\n').filter(Boolean);

    const upstreamStats = gitExec(`diff --stat HEAD ${fetchHead} 2>/dev/null`, gitRepoPath);

    // 你的自定义修改文件
    const myFiles = gitExec(`diff --name-only ${base} HEAD`, gitRepoPath)
      .split('\n').filter(Boolean);

    // 找出你和上游都修改的文件（冲突风险）
    const conflictFiles = myFiles.filter(f => upstreamFiles.includes(f));

    return {
      myCommits,
      myFilesCount: myFiles.length,
      upstreamCommits,
      upstreamFilesCount: upstreamFiles.length,
      upstreamStats,
      conflictFiles,
      conflictCount: conflictFiles.length,
      forkBase: base,
      currentHead: gitExec('rev-parse --short HEAD', gitRepoPath),
      upstreamHead: fetchHead.substring(0, 7),
      fetchError: null as string | null,
      fetchSkipped: false,
    };
  }

  // 检查文件是否应该排除
  function isExcluded(file: string): boolean {
    return EXCLUDE_PATTERNS.some(pattern => file.includes(pattern));
  }
}
