#compdef wtm

_wtm_worktree_branches() {
  local output
  output="$(wtm completion worktrees "$PREFIX" 2>/dev/null)" || return 1
  if [[ -z "$output" ]]; then
    return 0
  fi

  local -a branches
  branches=("${(@f)output}")
  branches=("${(@)branches:#}")
  (( ${#branches[@]} == 0 )) && return 0

  # Match slash-delimited branch names the same way zsh's git completion does.
  compadd -M 'r:|/=* r:|=*' -- "${branches[@]}"
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

_wtm_new() {
  # Subcommand-specific `_arguments` specs should see a line like `wtm featu`,
  # not `wtm open featu`, otherwise the subcommand itself is consumed as the
  # first positional argument and zsh never asks us to complete the real target.
  local -a shifted_words
  shifted_words=("${words[1]}" "${(@)words[3,-1]}")
  words=("${shifted_words[@]}")
  CURRENT=$(( CURRENT - 1 ))

  local has_issue=0
  local word

  for word in "${words[@]}"; do
    if [[ "$word" == "--issue" ]]; then
      has_issue=1
      break
    fi
  done

  if (( has_issue )); then
    _arguments -A '-*' \
      '--agent[choose which agent to launch]:agent:_wtm_agents' \
      '--no-agent[skip agent launch]' \
      '--yolo[launch codex with --full-auto or claude with --dangerously-skip-permissions]' \
      '--issue[create a worktree from a Linear issue]::issue id: ' \
      '--workspace[target Linear workspace]:workspace slug: '
  else
    _arguments -A '-*' \
      '--agent[choose which agent to launch]:agent:_wtm_agents' \
      '--no-agent[skip agent launch]' \
      '--yolo[launch codex with --full-auto or claude with --dangerously-skip-permissions]' \
      '--issue[create a worktree from a Linear issue]::issue id: ' \
      '1:branch slug: '
  fi
}

_wtm_open() {
  local -a shifted_words
  shifted_words=("${words[1]}" "${(@)words[3,-1]}")
  words=("${shifted_words[@]}")
  CURRENT=$(( CURRENT - 1 ))

  local curcontext="$curcontext" state state_descr line context
  typeset -A opt_args

  # Stop offering option matches once zsh is completing the first positional.
  _arguments -C -A '-*' \
    '--agent[choose which agent to launch]:agent:_wtm_agents' \
    '--no-agent[skip agent launch]' \
    '--yolo[launch codex with --full-auto or claude with --dangerously-skip-permissions]' \
    '1:worktree:->worktree' \
    && return 0

  case "$state" in
    worktree) _wtm_worktree_branches ;;
  esac
}

_wtm_rm() {
  local -a shifted_words
  shifted_words=("${words[1]}" "${(@)words[3,-1]}")
  words=("${shifted_words[@]}")
  CURRENT=$(( CURRENT - 1 ))

  local curcontext="$curcontext" state state_descr line context
  typeset -A opt_args

  # Stop offering option matches once zsh is completing the first positional.
  _arguments -C -A '-*' \
    '--force[remove even if the worktree is dirty]' \
    '1:worktree:->worktree' \
    && return 0

  case "$state" in
    worktree) _wtm_worktree_branches ;;
  esac
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
    'completion:print completion data'
    'help:show help'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "${words[2]}" in
    new)
      _wtm_new
      ;;
    open)
      _wtm_open
      ;;
    rm)
      _wtm_rm
      ;;
    list)
      _arguments '--pick[choose a worktree interactively]'
      ;;
    clean)
      _arguments '--force[remove dirty merged worktrees]'
      ;;
    completion|prune|help)
      ;;
  esac
}

# Register with compdef, deferring until compinit has loaded if necessary.
# Without this guard, sourcing _wtm.zsh before `autoload -Uz compinit && compinit`
# silently fails because compdef is not yet defined, leaving completion unbound.
if (( $+functions[compdef] )); then
  compdef _wtm wtm
else
  _wtm_deferred_compdef() {
    if (( $+functions[compdef] )); then
      compdef _wtm wtm
      add-zsh-hook -d precmd _wtm_deferred_compdef
      unfunction _wtm_deferred_compdef
    fi
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _wtm_deferred_compdef
fi
