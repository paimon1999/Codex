#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# my-changes.sh — Ucodex 自定义修改管理工具
# 用法：./scripts/my-changes.sh <命令> [参数]
# ─────────────────────────────────────────────────────────────
set -eo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# 自定义修改的基准 commit（上游分叉点）
BASE="151b36e"
# 自定义修改的 HEAD
HEAD="a0fd557"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 功能分类映射（格式：文件模式|功能1,功能2）──
FEATURE_MAP=(
  "proxy_stats.rs|流量统计"
  "stats_persistence.rs|流量统计"
  "launcher.rs|流量统计,端口冲突修复,无调试端口修复"
  "commands.rs|流量统计,启动验证,进程管理"
  "lib.rs|命令注册"
  "App.tsx|流量统计UI,进程管理UI"
  "styles.css|UI样式"
  "renderer-inject.js|模型名称注入,状态指示器"
  "config_manager.rs|配置管理修复"
  "package.json|前端依赖"
  "Cargo.toml|Rust依赖"
)

# ── 帮助 ──
usage() {
  cat <<EOF
${BOLD}Ucodex 自定义修改管理工具${NC}

${YELLOW}用法:${NC}
  $0 <命令> [参数]

${YELLOW}命令:${NC}
  ${GREEN}list${NC}                    列出所有修改的文件（带行数统计）
  ${GREEN}show${NC}  <文件名>           显示指定文件的 diff（支持模糊匹配）
  ${GREEN}search${NC} <关键词>          在所有修改中搜索关键词
  ${GREEN}feature${NC} [功能名]         按功能筛选文件（不带参数列出所有功能）
  ${GREEN}stats${NC}                   显示修改统计摘要
  ${GREEN}export${NC} [目录]            导出所有修改为 patch 文件
  ${GREEN}conflict${NC}                显示与上游冲突分析
  ${GREEN}tree${NC}                    显示修改文件树状图

${YELLOW}示例:${NC}
  $0 list                      # 列出所有修改文件
  $0 show commands             # 查看 commands.rs 的 diff
  $0 search "launch_codex"     # 搜索包含 launch_codex 的改动
  $0 feature 流量统计           # 查看流量统计相关的所有文件
  $0 export ~/Desktop/patches  # 导出 patch 到桌面
EOF
}

# ── list：列出所有修改文件 ──
cmd_list() {
  echo -e "${BOLD}📋 自定义修改文件列表${NC}（${BASE} → ${HEAD}）"
  echo ""
  printf "${CYAN}%-6s %-8s %s${NC}\n" "行数" "类型" "文件路径"
  echo "─────────────────────────────────────────────────────────"

  git diff --numstat "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | sort -t$'\t' -k1 -rn \
  | while IFS=$'\t' read -r added removed file; do
      total=$((added + removed))
      if [ "$total" -gt 200 ]; then
        type="🔴 高"
      elif [ "$total" -gt 50 ]; then
        type="🟡 中"
      else
        type="🟢 低"
      fi
      printf "%-6s %-8s %s\n" "+$added" "$type" "$file"
    done
}

# ── show：显示指定文件的 diff ──
cmd_show() {
  local pattern="$1"
  local files
  files=$(git diff --name-only "$BASE".."$HEAD" | grep -i "$pattern" || true)

  if [ -z "$files" ]; then
    echo -e "${RED}未找到匹配 '$pattern' 的文件${NC}"
    exit 1
  fi

  local count
  count=$(echo "$files" | wc -l | tr -d ' ')
  if [ "$count" -gt 1 ]; then
    echo -e "${YELLOW}找到 $count 个匹配文件:${NC}"
    echo "$files" | nl
    echo ""
    echo -e "显示全部 diff："
  fi

  echo "$files" | while IFS= read -r file; do
    echo ""
    echo -e "${BOLD}━━━ $file ━━━${NC}"
    git diff "$BASE".."$HEAD" -- "$file"
  done
}

# ── search：搜索关键词 ──
cmd_search() {
  local keyword="$1"
  echo -e "${BOLD}🔍 搜索关键词: '$keyword'${NC}"
  echo ""

  git diff "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | grep -n -i --color=always "$keyword" || {
    echo -e "${YELLOW}未找到匹配内容${NC}"
    exit 0
  }

  echo ""
  echo -e "${CYAN}─── 按文件统计匹配数 ───${NC}"
  git diff "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | grep -c "^[+-].*$keyword" 2>/dev/null || true
}

# ── feature：按功能筛选 ──
cmd_feature() {
  if [ -z "${1:-}" ]; then
    echo -e "${BOLD}🏷️  功能列表${NC}"
    echo ""
    # 提取所有功能名并计数
    for entry in "${FEATURE_MAP[@]}"; do
      echo "${entry#*|}" | tr ',' '\n'
    done | sort | uniq -c | sort -rn | while read -r count name; do
      echo -e "  ${GREEN}$name${NC}（$count 个文件）"
    done
    return
  fi

  local target="$1"
  echo -e "${BOLD}🏷️  功能: $target${NC}"
  echo ""

  for entry in "${FEATURE_MAP[@]}"; do
    local pattern="${entry%%|*}"
    local features="${entry#*|}"
    if echo "$features" | grep -q "$target"; then
      local matched_files
      matched_files=$(git diff --name-only "$BASE".."$HEAD" | grep "$pattern" || true)
      if [ -n "$matched_files" ]; then
        echo "$matched_files" | while IFS= read -r f; do
          local stats
          stats=$(git diff --stat "$BASE".."$HEAD" -- "$f" | tail -1)
          echo -e "  ${GREEN}$f${NC}  $stats"
        done
      fi
    fi
  done
}

# ── stats：统计摘要 ──
cmd_stats() {
  echo -e "${BOLD}📊 自定义修改统计${NC}"
  echo ""

  local files added removed
  files=$(git diff --name-only "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' | wc -l | tr -d ' ')
  added=$(git diff --numstat "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' | awk '{s+=$1} END {print s}')
  removed=$(git diff --numstat "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' | awk '{s+=$2} END {print s}')

  echo -e "  修改文件数:  ${BOLD}$files${NC}"
  echo -e "  新增行数:    ${GREEN}+$added${NC}"
  echo -e "  删除行数:    ${RED}-$removed${NC}"
  echo -e "  净变化:      $((added - removed)) 行"
  echo ""

  echo -e "${BOLD}按目录分布:${NC}"
  git diff --name-only "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -10 \
  | while read -r count dir; do
      printf "  %3d  %s\n" "$count" "$dir"
    done

  echo ""
  echo -e "${BOLD}按文件类型:${NC}"
  git diff --name-only "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | sed 's/.*\.//' | sort | uniq -c | sort -rn \
  | while read -r count ext; do
      printf "  %3d  .%s\n" "$count" "$ext"
    done
}

# ── export：导出 patch ──
cmd_export() {
  local outdir="${1:-$REPO_ROOT/patches}"
  mkdir -p "$outdir"

  echo -e "${BOLD}📦 导出 patch 文件到: $outdir${NC}"
  echo ""

  git diff --name-only "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | while IFS= read -r file; do
      local safe_name
      safe_name=$(echo "$file" | tr '/' '_')
      git diff "$BASE".."$HEAD" -- "$file" > "$outdir/$safe_name.patch"
      echo -e "  ${GREEN}✓${NC} $safe_name.patch"
    done

  # 生成完整 patch
  git diff "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  > "$outdir/full.patch"

  echo ""
  echo -e "${GREEN}✅ 已导出 $outdir/full.patch（完整 patch）${NC}"
}

# ── conflict：冲突分析 ──
cmd_conflict() {
  echo -e "${BOLD}⚠️  与上游冲突分析${NC}（${BASE} → FETCH_HEAD）"
  echo ""

  # 确保 FETCH_HEAD 存在
  if ! git rev-parse FETCH_HEAD &>/dev/null; then
    echo -e "${YELLOW}正在拉取上游...${NC}"
    git fetch https://github.com/BigPizzaV3/CodexPlusPlus.git main 2>/dev/null || true
  fi

  printf "${CYAN}%-55s %-8s %-8s %s${NC}\n" "文件" "你的" "上游" "风险"
  echo "─────────────────────────────────────────────────────────────────────────"

  git diff --name-only "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | while IFS= read -r file; do
      local my_lines up_lines
      my_lines=$(git diff "$BASE".."$HEAD" -- "$file" | grep -c '^[+-]' || echo 0)
      up_lines=$(git diff "$HEAD"..FETCH_HEAD -- "$file" 2>/dev/null | grep -c '^[+-]' || echo 0)

      local risk
      if [ "$up_lines" -eq 0 ]; then
        risk="${GREEN}✅ 安全${NC}"
      elif [ "$up_lines" -gt 200 ]; then
        risk="${RED}🔴 高${NC}"
      elif [ "$up_lines" -gt 50 ]; then
        risk="${YELLOW}🟡 中${NC}"
      else
        risk="${GREEN}🟢 低${NC}"
      fi

      printf "%-55s %-8s %-8s %b\n" "$file" "$my_lines" "$up_lines" "$risk"
    done
}

# ── tree：树状图 ──
cmd_tree() {
  echo -e "${BOLD}🌳 修改文件树状图${NC}"
  echo ""
  git diff --name-only "$BASE".."$HEAD" -- \
':!**/node_modules/**' ':!package-lock.json' ':!.workbuddy/**' \
  | sort \
  | awk -F/ '{
      indent=""
      for(i=1; i<NF; i++) {
        if($i != prev[i]) {
          printf "%s%s/\n", indent, $i
        }
        indent = indent "  "
        prev[i] = $i
      }
      printf "%s%s\n", indent, $NF
      for(i=NF+1; i<=length(prev); i++) delete prev[i]
    }'
}

# ── 主入口 ──
case "${1:-}" in
  list)     cmd_list ;;
  show)     cmd_show "${2:?请指定文件名}" ;;
  search)   cmd_search "${2:?请指定搜索关键词}" ;;
  feature)  cmd_feature "${2:-}" ;;
  stats)    cmd_stats ;;
  export)   cmd_export "${2:-}" ;;
  conflict) cmd_conflict ;;
  tree)     cmd_tree ;;
  help|-h|--help) usage ;;
  "")
    usage
    ;;
  *)
    echo -e "${RED}未知命令: $1${NC}"
    echo ""
    usage
    exit 1
    ;;
esac
