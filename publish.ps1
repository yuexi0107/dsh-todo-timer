# dsh-todo-timer 一键发布脚本
# 用法：pwsh -File publish.ps1 -Owner <你的GitHub用户名> [-Repo dsh-todo-timer]
# 前置：仓库已在 GitHub 上创建（空仓库），git 凭据可用（首次推送可能弹登录窗）
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = "dsh-todo-timer",
  [string]$Branch = "main"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repoUrl = "https://github.com/$Owner/$Repo"
$rawUrl  = "https://raw.githubusercontent.com/$Owner/$Repo/$Branch/market-index.json"

# 1. 把占位符替换为真实仓库地址
foreach ($f in @("market-index.json", "dsh-todo-timer\package.json", "dsh-todo-timer\README.md")) {
  $c = Get-Content $f -Raw
  $c = $c -replace "GITHUB_OWNER", $Owner
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot $f), $c)
}
Write-Host "占位符已替换为 $Owner"

# 2. 提交并推送
git add -A
git -c user.name="$Owner" -c user.email="$Owner@users.noreply.github.com" commit -m "release: publish as $Owner/$Repo" --allow-empty
git branch -M $Branch
if (-not (git remote get-url origin -ErrorAction SilentlyContinue)) {
  git remote add origin $repoUrl
}
git push -u origin $Branch
$sha = git rev-parse HEAD
Write-Host "已推送。commit: $sha"

# 3. 把真实 commit SHA 写回市场索引并再推一次（git source 要求 40 位 SHA 与内容一致）
$idx = Get-Content "market-index.json" -Raw
$idx = $idx -replace '"commit":\s*"[0-9a-f]{40}"', "`"commit`": `"$sha`""
[IO.File]::WriteAllText("$PSScriptRoot\market-index.json", $idx)
git add market-index.json
git -c user.name="$Owner" -c user.email="$Owner@users.noreply.github.com" commit -m "chore: pin market index to $sha"
git push
$sha2 = git rev-parse HEAD
Write-Host ""
Write-Host "=== 发布完成 ==="
Write-Host "市场索引 URL（发给其他设备/账号，在 DSH 发现页添加）:"
Write-Host "  $rawUrl"
Write-Host "直接安装 spec（插件页 → 安装）:"
Write-Host "  git+$repoUrl.git#$sha2&path:/dsh-todo-timer"
Write-Host "注意：market-index.json 里的 commit 指向上一提交 $sha，pnpm 按该 SHA 检出插件代码，内容一致，无需再改。"
