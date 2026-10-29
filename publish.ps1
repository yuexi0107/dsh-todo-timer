# dsh-todo-timer 一键发布脚本（0.3.0）
# 用法：pwsh -File publish.ps1 -Owner <你的GitHub用户名> [-Repo dsh-todo-timer] [-Branch main] [-DryRun]
# 前置：仓库已在 GitHub 上创建（public 空仓库），git 凭据可用（首次推送可能弹登录窗）
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = "dsh-todo-timer",
  [string]$Branch = "main",
  [switch]$DryRun
)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$repoUrl  = "https://github.com/$Owner/$Repo"
$rawUrl   = "https://raw.githubusercontent.com/$Owner/$Repo/$Branch/market-index.json"
$pluginDir = Join-Path $PSScriptRoot "dsh-todo-timer"
$marketPath = Join-Path $PSScriptRoot "market-index.json"
$packagePath = Join-Path $pluginDir "package.json"
$readmePath = Join-Path $pluginDir "README.md"
$awesomePath = Join-Path $PSScriptRoot "release\awesome-entry.yml"
$validatePath = Join-Path $PSScriptRoot "validate-index.mjs"

function Invoke-Git {
  param([string[]]$GitArgs)
  & git -c credential.helper= @GitArgs 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') 失败（exit $LASTEXITCODE）" }
}

function Write-PlaceholderPlan {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $text = Get-Content -Path $Path -Raw -Encoding UTF8
  if ($text -match "GITHUB_OWNER") {
    Write-Host "  将替换占位符: $Path"
  } else {
    Write-Host "  无 GITHUB_OWNER 占位符（可能已替换）: $Path"
  }
}

function Replace-Placeholder {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $text = Get-Content -Path $Path -Raw -Encoding UTF8
  if ($text -notmatch "GITHUB_OWNER") { return }
  $text = $text -replace "GITHUB_OWNER", $Owner
  [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
  Write-Host "已替换占位符: $Path"
}

# 1. 版本一致性：package.json 与市场索引最新版本必须一致
$pkg = Get-Content $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$index = Get-Content $marketPath -Raw -Encoding UTF8 | ConvertFrom-Json
$latest = $index.plugins[0].versions[0]
if ($pkg.version -ne $latest.version) {
  throw "版本不一致: package.json=$($pkg.version), market-index=$($latest.version)"
}
$zeroCommit = "0" * 40
if ($latest.source.commit -ne $zeroCommit) {
  Write-Warning "market-index 最新版本 commit 不是 40 个 0 哨兵：$($latest.source.commit)"
}
Write-Host "版本检查通过: $($pkg.version)"

# 2. 仓库可达性（空仓库也可通过；不存在的仓库会失败）
Write-Host "检查 GitHub 仓库: $repoUrl"
& git -c credential.helper= ls-remote $repoUrl | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "无法访问 $repoUrl。请先在 GitHub 创建 public 空仓库（不要初始化 README/license），并确认本机 git 凭据可用。"
}

# 3. DryRun：只报告计划，不写文件、不提交、不推送
if ($DryRun) {
  Write-Host ""
  Write-Host "=== DryRun：以下为计划，未写入/未提交/未推送 ==="
  foreach ($f in @($marketPath, $packagePath, $readmePath, $awesomePath, $validatePath)) { Write-PlaceholderPlan $f }
  Write-Host "将提交并推送到: $repoUrl ($Branch)"
  Write-Host "将创建/覆盖 tag: v$($pkg.version)"
  Write-Host "市场索引 URL: $rawUrl"
  Write-Host "安装 spec: git+$repoUrl.git#<commit-sha>&path:/dsh-todo-timer"
  exit 0
}

# 4. 替换占位符（只替换 GITHUB_OWNER）
foreach ($f in @($marketPath, $packagePath, $readmePath, $awesomePath, $validatePath)) { Replace-Placeholder $f }

# 5. 提交并推送代码
Invoke-Git @("add", "-A")
Invoke-Git @("-c", "user.name=$Owner", "-c", "user.email=$Owner@users.noreply.github.com", "commit", "-m", "release: v$($pkg.version) — status counts, numbered rows, frozen completed durations", "--allow-empty")
Invoke-Git @("branch", "-M", $Branch)
$remotes = & git remote
if ($LASTEXITCODE -ne 0) { throw "git remote 失败（exit $LASTEXITCODE）" }
if ($remotes -contains "origin") {
  $origin = (& git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0) { throw "git remote get-url origin 失败（exit $LASTEXITCODE）" }
  if ($origin -ne $repoUrl) { Invoke-Git @("remote", "set-url", "origin", $repoUrl) }
} else {
  Invoke-Git @("remote", "add", "origin", $repoUrl)
}
Invoke-Git @("push", "-u", "origin", $Branch)
Invoke-Git @("tag", "-f", "v$($pkg.version)")
Invoke-Git @("push", "-f", "origin", "refs/tags/v$($pkg.version)")
$sha = (& git rev-parse HEAD).Trim()
Write-Host "代码已推送。commit: $sha"

# 6. 只把 0.3.0 的 40 个 0 哨兵替换为代码提交 SHA（不碰 0.2.0/0.1.3 的历史 commit）
$idxText = Get-Content $marketPath -Raw -Encoding UTF8
if ($idxText -match '"commit":\s*"0{40}"') {
  $idxText = $idxText -replace '"commit":\s*"0{40}"', "`"commit`": `"$sha`""
  [IO.File]::WriteAllText($marketPath, $idxText, [Text.UTF8Encoding]::new($false))
  Invoke-Git @("add", "market-index.json")
  Invoke-Git @("-c", "user.name=$Owner", "-c", "user.email=$Owner@users.noreply.github.com", "commit", "-m", "chore: pin market index 0.3.0 to $sha")
  Invoke-Git @("push")
} else {
  Write-Host "market-index 0.3.0 已经 pin 过，跳过 pin 提交"
}
$sha2 = (& git rev-parse HEAD).Trim()

Write-Host ""
Write-Host "=== 发布完成 ==="
Write-Host "市场索引 URL（发给其他设备/账号，在 DSH 发现页添加）:"
Write-Host "  $rawUrl"
Write-Host "直接安装 spec（插件页 → 安装）:"
Write-Host "  git+$repoUrl.git#$sha&path:/dsh-todo-timer"
Write-Host "注意：market-index.json 的 0.3.0 commit 指向代码提交 $sha（不是索引提交 $sha2），内容一致，无需再改。"
