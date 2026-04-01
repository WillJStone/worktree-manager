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
      _arguments \
        '--agent[choose which agent to launch]:agent:_wtm_agents' \
        '--no-agent[skip agent launch]' \
        '1:branch slug: '
      ;;
    list)
      _arguments '--pick[choose a worktree interactively]'
      ;;
    open)
      if (( CURRENT == 3 )) && [[ "${words[CURRENT]}" != -* ]]; then
        _wtm_worktree_branches
        return
      fi
      _arguments \
        '--agent[choose which agent to launch]:agent:_wtm_agents' \
        '--no-agent[skip agent launch]'
      ;;
    rm)
      if (( CURRENT == 3 )) && [[ "${words[CURRENT]}" != -* ]]; then
        _wtm_worktree_branches
        return
      fi
      _arguments '--force[remove even if the worktree is dirty]'
      ;;
    prune|help)
      ;;
  esac
}

compdef _wtm wtm
