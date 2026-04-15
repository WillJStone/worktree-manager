#compdef wtm

_wtm_worktree_branches() {
  local -a branches
  branches=("${(@f)$(wtm completion worktrees "$PREFIX" 2>/dev/null)}")

  if (( ${#branches[@]} > 0 )); then
    compadd -- "${branches[@]}"
  fi
}

_wtm_agents() {
  local -a agents
  agents=(
    'codex:launch Codex'
    'claude:launch Claude'
    'pi:launch Pi'
  )
  _describe 'agent' agents
}

_wtm() {
  local -a commands
  commands=(
    'new:create a new worktree from the repo default branch'
    'list:list worktrees for the current repo'
    'open:open an existing worktree'
    'rm:remove an existing worktree'
    'clean:review and remove merged or stale worktree candidates'
    'prune:prune stale worktree metadata'
    'help:show help'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "${words[2]}" in
    new)
      local has_issue=0
      local word

      for word in "${words[@]}"; do
        if [[ "$word" == "--issue" ]]; then
          has_issue=1
          break
        fi
      done

      if (( has_issue )); then
        _arguments \
          '--agent[choose which agent to launch]:agent:_wtm_agents' \
          '--no-agent[skip agent launch]' \
          '--yolo[launch claude with --dangerously-skip-permissions]' \
          '--issue[create a worktree from a Linear issue]::issue id: ' \
          '--workspace[target Linear workspace]:workspace slug: '
      else
        _arguments \
          '--agent[choose which agent to launch]:agent:_wtm_agents' \
          '--no-agent[skip agent launch]' \
          '--yolo[launch claude with --dangerously-skip-permissions]' \
          '--issue[create a worktree from a Linear issue]::issue id: ' \
          '1:branch slug: '
      fi
      ;;
    list)
      _arguments '--pick[choose a worktree interactively]'
      ;;
    open)
      _arguments \
        '--agent[choose which agent to launch]:agent:_wtm_agents' \
        '--no-agent[skip agent launch]' \
        '--yolo[launch claude with --dangerously-skip-permissions]' \
        '1:worktree:_wtm_worktree_branches'
      ;;
    rm)
      _arguments \
        '--force[remove even if the worktree is dirty]' \
        '1:worktree:_wtm_worktree_branches'
      ;;
    clean)
      _arguments '--force[remove dirty merged worktrees]'
      ;;
    prune|help)
      ;;
  esac
}

compdef _wtm wtm
