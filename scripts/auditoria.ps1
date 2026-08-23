#Requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"

$outputDir = "$env:USERPROFILE\Desktop"
if (!(Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$md = @()

function Section($t) { $script:md += ""; $script:md += "## $t"; $script:md += "" }
function Line($t)   { $script:md += $t }
function Code($t)   { $script:md += $t }
function KV($k, $v) { $script:md += "- **" + $k + "**: " + $v }

Line "# Auditoria - Alquileres La Casona"
Line ""
Line "**Fecha**: $ts"
Line "**Maquina**: $env:COMPUTERNAME"
Line "**Usuario Windows**: $env:USERNAME"
Line ""

Section "1. Herramientas Instaladas"

$tools = @(
    @{ Name="Node.js";    Cmd="node";     Arg="--version" },
    @{ Name="npm";        Cmd="npm";      Arg="--version" },
    @{ Name="npx";        Cmd="npx";      Arg="--version" },
    @{ Name="Git";        Cmd="git";      Arg="--version" },
    @{ Name="Python";     Cmd="python";   Arg="--version" },
    @{ Name="Java";       Cmd="java";     Arg="--version" },
    @{ Name="PM2";        Cmd="pm2";      Arg="--version" },
    @{ Name="ngrok";      Cmd="ngrok";    Arg="version" },
    @{ Name="Firebase";   Cmd="firebase"; Arg="--version" },
    @{ Name="Vercel";     Cmd="vercel";   Arg="--version" },
    @{ Name="Netlify";    Cmd="netlify";  Arg="--version" },
    @{ Name="AWS CLI";    Cmd="aws";      Arg="--version" },
    @{ Name="gcloud";     Cmd="gcloud";   Arg="--version" },
    @{ Name="Docker";     Cmd="docker";   Arg="--version" },
    @{ Name="PHP";        Cmd="php";      Arg="--version" }
)

foreach ($t in $tools) {
    $cmd = Get-Command $t.Cmd -ErrorAction SilentlyContinue
    if ($cmd) {
        $ver = & $t.Cmd $t.Arg 2>&1 | Select-Object -First 1
        KV $t.Name $ver
    }
}

Line ""
Line "**Paquetes npm globales**:"
$globalNpm = npm list -g --depth=0 2>&1
foreach ($line in $globalNpm) {
    if ($line -match "- |o-") { Line "- " + $line.Trim() }
}

Section "2. Firebase"

$fbConfig = "$env:APPDATA\configstore\firebase-tools.json"
if (Test-Path $fbConfig) {
    Line "**Firebase tools config**: encontrada"
    $cfg = Get-Content $fbConfig -Raw | ConvertFrom-Json
    if ($cfg.user) {
        KV "Email logueado" $cfg.user.email
        KV "User ID" $cfg.user.uid
    }
    if ($cfg.tokens) { KV "Tokens de auth" "presentes" }
} else {
    Line "**Firebase tools config**: NO encontrada"
}

$adcPaths = @(
    "$env:APPDATA\gcloud\application_default_credentials.json",
    "$env:USERPROFILE\.config\gcloud\application_default_credentials.json"
)
foreach ($adc in $adcPaths) {
    if (Test-Path $adc) {
        Line ""
        Line "**Application Default Credentials**: " + $adc
        $adcC = Get-Content $adc -Raw | ConvertFrom-Json
        if ($adcC.quota_project_id) { KV "Quota project" $adcC.quota_project_id }
        if ($adcC.client_email)     { KV "Client email"  $adcC.client_email }
    }
}

Section "3. Proyectos Encontrados"

$searchRoots = @(
    "C:\Users\$env:USERNAME\Desktop",
    "C:\Users\$env:USERNAME\Documents",
    "C:\Users\$env:USERNAME\Downloads",
    "C:\Users\$env:USERNAME",
    "D:\",
    "E:\",
    "C:\Projects",
    "C:\dev",
    "C:\workspace",
    "C:\xampp\htdocs"
)

$foundProjects = @()
foreach ($root in $searchRoots) {
    if (!(Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Filter "firebase.json" -Recurse -Depth 4 -ErrorAction SilentlyContinue | ForEach-Object {
        $foundProjects += $_.DirectoryName
    }
}
$foundProjects = $foundProjects | Sort-Object -Unique

if ($foundProjects.Count -gt 0) {
    Line "**Proyectos Firebase encontrados**: $($foundProjects.Count)"
    foreach ($p in $foundProjects) {
        Line ""
        Line "### " + $p

        $rc = Join-Path $p ".firebaserc"
        if (Test-Path $rc) {
            $rcContent = Get-Content $rc -Raw
            Line "**.firebaserc**:"
            Line "---"
            Line $rcContent
            Line "---"
            if ($rcContent -match "default") {
                $parts = $rcContent -split "\"
                for ($i = 0; $i -lt $parts.Count; $i++) {
                    if ($parts[$i] -eq "default" -and ($i + 2) -lt $parts.Count) {
                        KV "Default project" $parts[$i + 2]
                        break
                    }
                }
            }
        }

        $fj = Join-Path $p "firebase.json"
        if (Test-Path $fj) {
            Line ""
            Line "**firebase.json** servicios:"
            $fjC = Get-Content $fj -Raw
            if ($fjC -match "hosting")  { Line "- Hosting" }
            if ($fjC -match "functions") { Line "- Functions" }
            if ($fjC -match "firestore") { Line "- Firestore" }
            if ($fjC -match "storage")   { Line "- Storage" }
            if ($fjC -match "emulators") { Line "- Emulators" }
        }

        Push-Location $p
        $remote = & git remote -v 2>&1 | Select-Object -First 1
        $branch = & git branch --show-current 2>&1
        $log    = & git log --oneline -5 2>&1
        Pop-Location

        if ($remote) {
            Line ""
            Line "**Git remote**: " + $remote
            KV "Branch" $branch
            Line ""
            Line "**Ultimos 5 commits**:"
            foreach ($c in $log) { Line "- " + $c }
        }
    }
} else {
    Line "No se encontraron proyectos Firebase."
}

Section "4. Archivos .env"

$envFiles = @()
foreach ($root in $searchRoots) {
    if (!(Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Filter ".env*" -Recurse -Depth 5 -File -ErrorAction SilentlyContinue | ForEach-Object {
        $envFiles += $_
    }
}
$envFiles = $envFiles | Sort-Object FullName -Unique

if ($envFiles.Count -gt 0) {
    Line "**Archivos .env encontrados**: $($envFiles.Count)"
    foreach ($ef in $envFiles) {
        Line ""
        Line "### " + $ef.FullName
        Line "**Modificado**: $($ef.LastWriteTime)"
        Line ""
        Line "---CONTENIDO---"
        $content = Get-Content $ef.FullName -Raw
        foreach ($line in ($content -split "`n")) {
            $tr = $line.Trim()
            if ($tr -match "^\s*#") {
                Line $tr
            } elseif ($tr -match "^[A-Za-z]") {
                $eqIdx = $tr.IndexOf("=")
                if ($eqIdx -gt 0) {
                    $key = $tr.Substring(0, $eqIdx)
                    $val = $tr.Substring($eqIdx + 1)
                    if ($key -match "TOKEN|SECRET|PASSWORD|KEY|PASS|AUTH|CREDENTIAL") {
                        if ($val.Length -gt 10) {
                            Line "$key=$($val.Substring(0,5))...$($val.Substring($val.Length-5))"
                        } elseif ($val.Length -gt 0) {
                            Line "$key=***"
                        } else {
                            Line "$key=(vacio)"
                        }
                    } else {
                        Line "$key=$val"
                    }
                } else {
                    Line $tr
                }
            } else {
                Line $tr
            }
        }
        Line "---FIN---"
    }
} else {
    Line "No se encontraron archivos .env."
}

Section "5. Cuentas y Credenciales"

Line "### Cuentas Google"

$gcloudRaw = & gcloud auth list 2>&1
if ($LASTEXITCODE -eq 0) {
    foreach ($gl in $gcloudRaw) {
        if ($gl -match "\*\s+(.+)") { KV "gcloud activa" $Matches[1] }
        if ($gl -match "(\S+@\S+)") { KV "gcloud cuenta" $Matches[1] }
    }
}

$fbC = "$env:APPDATA\configstore\firebase-tools.json"
if (Test-Path $fbC) {
    $cfg3 = Get-Content $fbC -Raw | ConvertFrom-Json
    if ($cfg3.user.email) { KV "Firebase CLI" $cfg3.user.email }
}

Line ""
Line "### Archivos de credenciales"
$credSearch = @()
foreach ($root in $searchRoots) {
    if (!(Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Filter "CREDENCIALES*" -Recurse -Depth 4 -File -ErrorAction SilentlyContinue | ForEach-Object {
        $credSearch += $_.FullName
    }
}
$credSearch = $credSearch | Sort-Object -Unique

foreach ($cf in $credSearch) {
    if (Test-Path $cf) {
        Line ""
        Line "**Archivo**: " + $cf
        Line "---CONTENIDO---"
        Line (Get-Content $cf -Raw)
        Line "---FIN---"
    }
}

Section "6. Variables de Entorno Relevantes"

$envVars = @(
    "FIREBASE_TOKEN","GCLOUD_PROJECT","GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT","VERCEL_TOKEN","NETLIFY_AUTH_TOKEN",
    "AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","DEPLOY_URL",
    "CI","GITHUB_TOKEN","NPM_TOKEN","NODE_AUTH_TOKEN",
    "MERCADO_PAGO_ACCESS_TOKEN","TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN",
    "SMTP_USER","SMTP_PASS","EMAIL_FROM","WEBAPP_URL"
)

$foundEnv = 0
foreach ($ev in $envVars) {
    $val = [Environment]::GetEnvironmentVariable($ev, "User")
    if (-not $val) { $val = [Environment]::GetEnvironmentVariable($ev, "Machine") }
    if ($val) {
        if ($val.Length -gt 12) {
            $masked = $val.Substring(0,5) + "..." + $val.Substring($val.Length-5)
        } else { $masked = "***" }
        KV $ev $masked
        $foundEnv++
    }
}
if ($foundEnv -eq 0) { Line "No se encontraron variables de entorno relevantes." }

Section "7. CI/CD Pipelines"

$ciFound = 0
foreach ($proj in $foundProjects) {
    $workflows = Join-Path $proj ".github\workflows"
    if (Test-Path $workflows) {
        Get-ChildItem -Path $workflows -Filter "*.yml" -ErrorAction SilentlyContinue | ForEach-Object {
            Line "- " + $_.Name + " en " + $proj
            $wf = Get-Content $_.FullName -Raw
            if ($wf -match "firebase") { Line "  **usa Firebase deploy**" }
            $ciFound++
        }
    }
}
if ($ciFound -eq 0) { Line "No se encontraron pipelines CI/CD." }

Section "8. Servicios Corriendo"

Line "### PM2"
$pm2Out = pm2 list 2>&1
if ($LASTEXITCODE -eq 0) {
    foreach ($l in $pm2Out) {
        if ($l -match "\d+\s+\S+") { Line "- " + $l.Trim() }
    }
} else {
    Line "PM2 no corriendo."
}

Line ""
Line "### Docker"
$dockerOut = docker ps --format "{{.Names}} | {{.Image}} | {{.Status}}" 2>&1
if ($LASTEXITCODE -eq 0 -and $dockerOut -notmatch "error") {
    foreach ($l in $dockerOut) { Line "- " + $l.Trim() }
} else {
    Line "Docker no corriendo o sin contenedores."
}

Line ""
Line "### IIS"
$sites = Get-WebSite -ErrorAction SilentlyContinue
if ($sites) {
    foreach ($s in $sites) {
        KV $s.Name $s.PhysicalPath
    }
} else {
    Line "IIS no configurado o sin sitios."
}

Section "9. Navegadores y Cuentas Chrome"

$chromeBase = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$edgeBase   = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"

$profileDirs = @()
if (Test-Path $chromeBase) { $profileDirs += $chromeBase }
if (Test-Path $edgeBase)   { $profileDirs += $edgeBase }

foreach ($base in $profileDirs) {
    $browser = if ($base -match "Chrome") { "Chrome" } else { "Edge" }
    Line "### $browser"

    $prefsFile = Join-Path $base "Default\Preferences"
    if (Test-Path $prefsFile) {
        $prefs = Get-Content $prefsFile -Raw | ConvertFrom-Json
        if ($prefs.account_info) {
            foreach ($acc in $prefs.account_info) {
                if ($acc.email) { KV "Cuenta" $acc.email }
            }
        } else {
            Line "- Sin cuentas logueadas"
        }
    }

    Get-ChildItem -Path $base -Directory -Filter "Profile*" -ErrorAction SilentlyContinue | ForEach-Object {
        $pp = Join-Path $_.FullName "Preferences"
        if (Test-Path $pp) {
            $p = Get-Content $pp -Raw | ConvertFrom-Json
            if ($p.account_info) {
                foreach ($acc in $p.account_info) {
                    if ($acc.email) { KV ("Cuenta (" + $_.Name + ")") $acc.email }
                }
            }
        }
    }
}

Section "10. Detalle de Proyectos Firebase"

foreach ($proj in $foundProjects) {
    $rc = Join-Path $proj ".firebaserc"
    if (!(Test-Path $rc)) { continue }

    $rcContent = Get-Content $rc -Raw
    $projId = ""
    if ($rcContent -match "default") {
        $parts = $rcContent -split "\"
        for ($i = 0; $i -lt $parts.Count; $i++) {
            if ($parts[$i] -eq "default" -and ($i + 2) -lt $parts.Count) {
                $projId = $parts[$i + 2]
                break
            }
        }
    }

    Line "### " + $proj
    KV "Project ID" $projId

    $fnDir = Join-Path $proj "functions"
    if (Test-Path $fnDir) {
        KV "Functions dir" "existe"
        $pkgJson = Join-Path $fnDir "package.json"
        if (Test-Path $pkgJson) {
            $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
            KV "Functions name" $pkg.name

            Get-ChildItem -Path $fnDir -Filter ".env*" -File -ErrorAction SilentlyContinue | ForEach-Object {
                Line ""
                Line "**functions/" + $_.Name + "**:"
                Line "---CONTENIDO---"
                $envC = Get-Content $_.FullName -Raw
                foreach ($line in ($envC -split "`n")) {
                    $tr = $line.Trim()
                    if ($tr -match "^[A-Za-z]") {
                        $eqIdx = $tr.IndexOf("=")
                        if ($eqIdx -gt 0) {
                            $k = $tr.Substring(0, $eqIdx)
                            $v = $tr.Substring($eqIdx + 1)
                            if ($k -match "TOKEN|SECRET|PASSWORD|KEY|PASS|AUTH") {
                                if ($v.Length -gt 10) { Line "$k=$($v.Substring(0,5))...$($v.Substring($v.Length-5))" }
                                else { Line "$k=***" }
                            } else { Line "$k=$v" }
                        } else { Line $tr }
                    } else { Line $tr }
                }
                Line "---FIN---"
            }
        }
    }

    $pubDir = Join-Path $proj "public"
    if (Test-Path $pubDir) {
        $htmlCount = (Get-ChildItem -Path $pubDir -Filter "*.html" -Recurse -ErrorAction SilentlyContinue).Count
        $jsCount   = (Get-ChildItem -Path $pubDir -Filter "*.js" -Recurse -ErrorAction SilentlyContinue).Count
        KV "public/" "$htmlCount HTML, $jsCount JS"
    }

    Line ""
}

Section "11. Archivos Sospechosos de Credenciales"

$susPatterns = @("credentials","password","secret","token","apikey","api-key",".pem",".key","service-account")
foreach ($root in $searchRoots) {
    if (!(Test-Path $root)) { continue }
    foreach ($pat in $susPatterns) {
        Get-ChildItem -Path $root -Filter ("*" + $pat + "*") -Recurse -Depth 3 -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = $_.FullName.Replace($root, "")
            KV $rel ("Modificado: " + $_.LastWriteTime)
        }
    }
}

Line ""
Line "---"
Line ""
Line "**Fin de la auditoria.**"

$reportPath = Join-Path $outputDir "audit.md"
$md | Out-File -FilePath $reportPath -Encoding UTF8 -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AUDITORIA COMPLETADA" -ForegroundColor Green
Write-Host ("  Reporte: " + $reportPath) -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

Start-Process notepad.exe $reportPath