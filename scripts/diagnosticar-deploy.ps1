#Requires -Version 5.1
<#
.SYNOPSIS
    Diagnóstico completo de deploy — detecta cómo se publica el sitio web.
.DESCRIPTION
    Correr en la máquina del cliente para detectar:
    - Herramientas de deploy instaladas (Firebase, Vercel, Netlify, AWS, etc.)
    - Configuraciones de proyecto (.firebaserc, firebase.json, etc.)
    - Git remotes y historial reciente
    - CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins, etc.)
    - Scripts npm de deploy
    - Servicios corriendo (PM2, Docker, IIS, Nginx)
    - Variables de entorno relevantes
    - Archivos de credenciales
.OUTPUTS
    Reporte en C:\deploy-diagnostic\diagnostico-deploy.txt
#>

$ErrorActionPreference = "SilentlyContinue"
$reportPath = "$env:USERPROFILE\Desktop"
$reportFile = "$reportPath\diagnostico-deploy.txt"

# Crear directorio de salida
if (!(Test-Path $reportPath)) { New-Item -ItemType Directory -Path $reportPath -Force | Out-Null }

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$report = @()

function Add-Section($title) {
    $report += ""
    $report += "=" * 60
    $report += "  $title"
    $report += "=" * 60
    $report += ""
}

function Add-Finding($label, $value, $severity = "INFO") {
    $icon = switch ($severity) {
        "CRITICAL" { "[!!!]" }
        "WARNING"  { "[!]" }
        "FOUND"    { "[+]" }
        "NOTFOUND" { "[-]" }
        default    { "[i]" }
    }
    $report += "  $icon $label`: $value"
}

# ===================================================================
# HEADER
# ===================================================================
$report += "================================================================"
$report += "  DIAGNOSTICO DE DEPLOY — ALQUILERES LA CASONA"
$report += "  Generado: $timestamp"
$report += "  Maquina: $env:COMPUTERNAME"
$report += "  Usuario: $env:USERNAME"
$report += "================================================================"

# ===================================================================
# 1. DETECCION DE HERRAMIENTAS INSTALADAS
# ===================================================================
Add-Section "1. HERRAMIENTAS DE DEPLOY INSTALADAS"

# Firebase CLI
$firebasePath = Get-Command firebase -ErrorAction SilentlyContinue
$firebaseNpx = Get-Command npx -ErrorAction SilentlyContinue
if ($firebasePath) {
    $firebaseVer = & firebase --version 2>&1 | Select-Object -First 1
    Add-Finding "Firebase CLI (global)" $firebaseVer "FOUND"
} elseif ($firebaseNpx) {
    $firebaseVer = & npx firebase-tools --version 2>&1 | Select-Object -First 1
    if ($firebaseVer -notmatch "Error") {
        Add-Finding "Firebase CLI (npx)" $firebaseVer "FOUND"
    } else {
        Add-Finding "Firebase CLI" "No encontrado" "NOTFOUND"
    }
} else {
    Add-Finding "Firebase CLI" "No encontrado" "NOTFOUND"
}

# Vercel
$vercelPath = Get-Command vercel -ErrorAction SilentlyContinue
if ($vercelPath) {
    $vercelVer = & vercel --version 2>&1 | Select-Object -First 1
    Add-Finding "Vercel CLI" $vercelVer "FOUND"
} else {
    Add-Finding "Vercel CLI" "No encontrado" "NOTFOUND"
}

# Netlify
$netlifyPath = Get-Command netlify -ErrorAction SilentlyContinue
if ($netlifyPath) {
    $netlifyVer = & netlify --version 2>&1 | Select-Object -First 1
    Add-Finding "Netlify CLI" $netlifyVer "FOUND"
} else {
    Add-Finding "Netlify CLI" "No encontrado" "NOTFOUND"
}

# AWS CLI
$awsPath = Get-Command aws -ErrorAction SilentlyContinue
if ($awsPath) {
    $awsVer = & aws --version 2>&1 | Select-Object -First 1
    Add-Finding "AWS CLI" $awsVer "FOUND"
} else {
    Add-Finding "AWS CLI" "No encontrado" "NOTFOUND"
}

# gcloud
$gcloudPath = Get-Command gcloud -ErrorAction SilentlyContinue
if ($gcloudPath) {
    $gcloudVer = & gcloud --version 2>&1 | Select-Object -First 1
    Add-Finding "Google Cloud SDK" $gcloudVer "FOUND"
} else {
    Add-Finding "Google Cloud SDK" "No encontrado" "NOTFOUND"
}

# Docker
$dockerPath = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerPath) {
    $dockerVer = & docker --version 2>&1 | Select-Object -First 1
    Add-Finding "Docker" $dockerVer "FOUND"
} else {
    Add-Finding "Docker" "No encontrado" "NOTFOUND"
}

# PM2
$pm2Path = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2Path) {
    $pm2Ver = & pm2 --version 2>&1 | Select-Object -First 1
    Add-Finding "PM2" $pm2Ver "FOUND"
} else {
    Add-Finding "PM2" "No encontrado" "NOTFOUND"
}

# Git
$gitPath = Get-Command git -ErrorAction SilentlyContinue
if ($gitPath) {
    $gitVer = & git --version 2>&1 | Select-Object -First 1
    Add-Finding "Git" $gitVer "FOUND"
} else {
    Add-Finding "Git" "No encontrado" "NOTFOUND"
}

# Node.js
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
    $nodeVer = & node --version 2>&1 | Select-Object -First 1
    Add-Finding "Node.js" $nodeVer "FOUND"
} else {
    Add-Finding "Node.js" "No encontrado" "NOTFOUND"
}

# npm
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if ($npmPath) {
    $npmVer = & npm --version 2>&1 | Select-Object -First 1
    Add-Finding "npm" $npmVer "FOUND"
} else {
    Add-Finding "npm" "No encontrado" "NOTFOUND"
}

# ===================================================================
# 2. BUSQUEDA DE PROYECTOS (carpetas comunes)
# ===================================================================
Add-Section "2. PROYECTOS ENCONTRADOS"

$searchPaths = @(
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

$firebaseProjects = @()
$nodeProjects = @()

foreach ($searchPath in $searchPaths) {
    if (!(Test-Path $searchPath)) { continue }
    
    # Buscar firebase.json (proyectos Firebase)
    Get-ChildItem -Path $searchPath -Filter "firebase.json" -Recurse -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object {
        $firebaseProjects += $_.DirectoryName
    }
    
    # Buscar package.json (proyectos Node)
    Get-ChildItem -Path $searchPath -Filter "package.json" -Recurse -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object {
        $nodeProjects += $_.DirectoryName
    }
}

$firebaseProjects = $firebaseProjects | Sort-Object -Unique
$nodeProjects = $nodeProjects | Sort-Object -Unique

if ($firebaseProjects.Count -gt 0) {
    Add-Finding "Proyectos Firebase" "$($firebaseProjects.Count) encontrados" "FOUND"
    foreach ($p in $firebaseProjects) {
        Add-Finding "  Firebase project" $p "FOUND"
    }
} else {
    Add-Finding "Proyectos Firebase" "Ninguno encontrado en rutas comunes" "NOTFOUND"
}

if ($nodeProjects.Count -gt 0) {
    Add-Finding "Proyectos Node.js" "$($nodeProjects.Count) encontrados" "FOUND"
    foreach ($p in ($nodeProjects | Select-Object -First 10)) {
        Add-Finding "  Node project" $p "FOUND"
    }
    if ($nodeProjects.Count -gt 10) {
        Add-Finding "  ... y otros" "$($nodeProjects.Count - 10) mas" "INFO"
    }
} else {
    Add-Finding "Proyectos Node.js" "Ninguno encontrado en rutas comunes" "NOTFOUND"
}

# ===================================================================
# 3. CONFIGURACION FIREBASE (si hay proyecto Firebase)
# ===================================================================
Add-Section "3. CONFIGURACION FIREBASE"

foreach ($projPath in $firebaseProjects) {
    Add-Finding "Proyecto Firebase" $projPath "FOUND"
    
    # .firebaserc
    $firebaserc = Join-Path $projPath ".firebaserc"
    if (Test-Path $firebaserc) {
        $content = Get-Content $firebaserc -Raw
        Add-Finding ".firebaserc" "Encontrado" "FOUND"
        # Extraer project IDs
        if ($content -match '"default"\s*:\s*"([^"]+)"') {
            Add-Finding "  Default project" $Matches[1] "FOUND"
        }
        if ($content -match '"alquileres-la-casona"') {
            Add-Finding "  >>> PROYECTO ALQUILERES" "ENCONTRADO" "CRITICAL"
        }
    }
    
    # firebase.json
    $firebaseJson = Join-Path $projPath "firebase.json"
    if (Test-Path $firebaseJson) {
        $content = Get-Content $firebaseJson -Raw
        Add-Finding "firebase.json" "Encontrado" "FOUND"
        if ($content -match '"hosting"') { Add-Finding "  Hosting" "Configurado" "FOUND" }
        if ($content -match '"functions"') { Add-Finding "  Functions" "Configuradas" "FOUND" }
        if ($content -match '"firestore"') { Add-Finding "  Firestore" "Configurado" "FOUND" }
        if ($content -match '"storage"') { Add-Finding "  Storage" "Configurado" "FOUND" }
    }
    
    # functions/ folder
    $functionsPath = Join-Path $projPath "functions"
    if (Test-Path $functionsPath) {
        Add-Finding "functions/" "Directorio existe" "FOUND"
        $pkgJson = Join-Path $functionsPath "package.json"
        if (Test-Path $pkgJson) {
            $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
            Add-Finding "  Functions name" $pkg.name "FOUND"
        }
    }
    
    # .env files
    Get-ChildItem -Path $projPath -Filter ".env*" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
        Add-Finding "  Env file" $_.FullName "FOUND"
    }
    
    # Git info
    Push-Location $projPath
    $gitRemote = & git remote -v 2>&1 | Select-Object -First 2
    $gitBranch = & git branch --show-current 2>&1
    $gitLastCommit = & git log --oneline -5 2>&1
    Pop-Location
    
    if ($gitRemote) {
        Add-Finding "Git remote" ($gitRemote -join " | ") "FOUND"
    }
    if ($gitBranch) {
        Add-Finding "Git branch" $gitBranch "FOUND"
    }
    if ($gitLastCommit) {
        Add-Finding "Last 5 commits" "" "INFO"
        foreach ($c in $gitLastCommit) { Add-Finding "  " $c "INFO" }
    }
}

# ===================================================================
# 4. CI/CD PIPELINES
# ===================================================================
Add-Section "4. CI/CD PIPELINES"

$ciLocations = @(
    ".github\workflows",
    ".gitlab-ci.yml",
    "Jenkinsfile",
    ".circleci",
    ".travis.yml",
    "bitbucket-pipelines.yml",
    "cloudbuild.yaml",
    "apphosting.yaml"
)

foreach ($projPath in ($firebaseProjects + $nodeProjects | Sort-Object -Unique)) {
    foreach ($ci in $ciLocations) {
        $ciPath = Join-Path $projPath $ci
        if (Test-Path $ciPath) {
            Add-Finding "CI/CD" "$ciPath" "FOUND"
            if ($ci -eq ".github\workflows") {
                Get-ChildItem -Path $ciPath -Filter "*.yml" -ErrorAction SilentlyContinue | ForEach-Object {
                    Add-Finding "  Workflow" $_.Name "FOUND"
                    $wfContent = Get-Content $_.FullName -Raw
                    if ($wfContent -match "firebase") {
                        Add-Finding "  >>> FIREBASE DEPLOY" $_.Name "CRITICAL"
                    }
                }
            }
        }
    }
}

# ===================================================================
# 5. SCRIPTS NPM DE DEPLOY
# ===================================================================
Add-Section "5. SCRIPTS NPM DE DEPLOY"

foreach ($projPath in ($firebaseProjects + $nodeProjects | Sort-Object -Unique)) {
    $pkgJson = Join-Path $projPath "package.json"
    if (!(Test-Path $pkgJson)) { continue }
    
    $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
    $deployScripts = @()
    
    if ($pkg.scripts) {
        $pkg.scripts.PSObject.Properties | ForEach-Object {
            if ($_.Name -match "deploy|publish|release|build|start|postinstall") {
                $deployScripts += "$($_.Name): $($_.Value)"
            }
        }
    }
    
    if ($deployScripts.Count -gt 0) {
        Add-Finding "Package" $projPath "FOUND"
        foreach ($s in $deployScripts) {
            Add-Finding "  Script" $s "FOUND"
        }
    }
}

# ===================================================================
# 6. SERVICIOS CORRIENDO
# ===================================================================
Add-Section "6. SERVICIOS CORRIENDO"

# PM2 processes
$pm2List = & pm2 list 2>&1
if ($LASTEXITCODE -eq 0) {
    Add-Finding "PM2" "Corriendo" "FOUND"
    $pm2List | Select-Object -First 15 | ForEach-Object {
        Add-Finding "  " $_.Trim() "INFO"
    }
} else {
    Add-Finding "PM2" "No corriendo o no instalado" "NOTFOUND"
}

# Docker containers
$dockerPs = & docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" 2>&1
if ($LASTEXITCODE -eq 0 -and $dockerPs -notmatch "error") {
    Add-Finding "Docker" "Contenedores activos" "FOUND"
    $dockerPs | Select-Object -First 10 | ForEach-Object {
        Add-Finding "  " $_.Trim() "INFO"
    }
}

# IIS sites
$iisSites = Get-WebSite -ErrorAction SilentlyContinue
if ($iisSites) {
    Add-Finding "IIS" "Sitios configurados" "FOUND"
    foreach ($site in $iisSites) {
        Add-Finding "  Site" "$($site.Name) -> $($site.PhysicalPath)" "FOUND"
    }
}

# Nginx
$nginxPath = Get-Command nginx -ErrorAction SilentlyContinue
if ($nginxPath) {
    Add-Finding "Nginx" "Instalado" "FOUND"
}

# ===================================================================
# 7. VARIABLES DE ENTORNO
# ===================================================================
Add-Section "7. VARIABLES DE ENTORNO RELEVANTES"

$envVars = @(
    "FIREBASE_TOKEN",
    "GCLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "VERCEL_TOKEN",
    "NETLIFY_AUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "DEPLOY_URL",
    "CI",
    "GITHUB_TOKEN"
)

foreach ($var in $envVars) {
    $val = [Environment]::GetEnvironmentVariable($var, "User")
    if (-not $val) { $val = [Environment]::GetEnvironmentVariable($var, "Machine") }
    if ($val) {
        # Enmascarar tokens/secretos
        if ($val.Length -gt 8) {
            $masked = $val.Substring(0, 4) + "..." + $val.Substring($val.Length - 4)
        } else {
            $masked = "***"
        }
        Add-Finding $var $masked "FOUND"
    }
}

# ===================================================================
# 8. CREDENCIALES FIREBASE
# ===================================================================
Add-Section "8. CREDENCIALES FIREBASE"

$firebaseConfigDir = "$env:APPDATA\firebase"
$firebaseTokens = "$env:APPDATA\configstore\firebase-tools.json"

if (Test-Path $firebaseTokens) {
    Add-Finding "Firebase config" $firebaseTokens "FOUND"
    $config = Get-Content $firebaseTokens -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($config.tokens) {
        Add-Finding "  Auth tokens" "Presentes" "FOUND"
    }
    if ($config.user) {
        Add-Finding "  User email" $config.user.email "FOUND"
    }
} else {
    Add-Finding "Firebase config" "No encontrada en AppData" "NOTFOUND"
}

# ===================================================================
# 9. ARCHIVOS RECIENTES DE DEPLOY
# ===================================================================
Add-Section "9. ARCHIVOS DE DEPLOY RECIENTES (ultimos 30 dias)"

foreach ($projPath in $firebaseProjects) {
    # .firestore.indexes.json
    $idxFile = Join-Path $projPath ".firestore.indexes.json"
    if (Test-Path $idxFile) {
        $lastWrite = (Get-Item $idxFile).LastWriteTime
        Add-Finding ".firestore.indexes.json" "Modificado: $lastWrite" "INFO"
    }
    
    # .firebaserc
    $rcFile = Join-Path $projPath ".firebaserc"
    if (Test-Path $rcFile) {
        $lastWrite = (Get-Item $rcFile).LastWriteTime
        Add-Finding ".firebaserc" "Modificado: $lastWrite" "INFO"
    }
    
    # firebase.json
    $fjFile = Join-Path $projPath "firebase.json"
    if (Test-Path $fjFile) {
        $lastWrite = (Get-Item $fjFile).LastWriteTime
        Add-Finding "firebase.json" "Modificado: $lastWrite" "INFO"
    }
    
    # .env files
    Get-ChildItem -Path $projPath -Filter ".env*" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
        Add-Finding $_.Name "Modificado: $($_.LastWriteTime)" "INFO"
    }
}

# ===================================================================
# 10. DIRECTORIOS DE CACHE/TEMP
# ===================================================================
Add-Section "10. CACHES DE DEPLOY"

$cacheDirs = @(
    "$env:LOCALAPPDATA\firebase\cache",
    "$env:LOCALAPPDATA\firebase\functions",
    "$env:APPDATA\firebase\cache",
    ".firebaserc",
    "node_modules\.cache"
)

foreach ($dir in $cacheDirs) {
    if (Test-Path $dir) {
        $size = (Get-ChildItem -Path $dir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sizeMB = [math]::Round($size / 1MB, 2)
        Add-Finding $dir "${sizeMB} MB" "INFO"
    }
}

# ===================================================================
# RESUMEN FINAL
# ===================================================================
Add-Section "RESUMEN"

$report += "  PROYECTOS FIREBASE: $($firebaseProjects.Count)"
$report += "  PROYECTOS NODE:    $($nodeProjects.Count)"
$report += ""

if ($firebaseProjects.Count -gt 0) {
    $report += "  >>> ACCION RECOMENDADA: Verificar configuracion Firebase en:"
    foreach ($p in $firebaseProjects) {
        $report += "      $p"
    }
    $report += ""
    $report += "  >>> COMANDOS UTILES:"
    $report += "      firebase login"
    $report += "      firebase projects:list"
    $report += "      firebase deploy --dry-run"
}

$report += ""
$report += "================================================================"
$report += "  FIN DEL DIAGNOSTICO"
$report += "  Archivo: $reportFile"
$report += "================================================================"

# Guardar reporte
$report | Out-File -FilePath $reportFile -Encoding UTF8 -Force

# Mostrar resumen en consola
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DIAGNOSTICO COMPLETADO" -ForegroundColor Green
Write-Host "  Reporte: $reportFile" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Resumen rapido:" -ForegroundColor White
Write-Host "  Firebase projects: $($firebaseProjects.Count)" -ForegroundColor $(if ($firebaseProjects.Count -gt 0) { "Green" } else { "Yellow" })
Write-Host "  Node projects:    $($nodeProjects.Count)" -ForegroundColor $(if ($nodeProjects.Count -gt 0) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "Abriendo reporte..." -ForegroundColor Cyan
Start-Process notepad.exe $reportFile
