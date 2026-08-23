# Backup production Firestore using REST API with admin token
# Superadmin can read all collections via Firestore rules

$apiKey = "AIzaSyAEbdMVbEaYBqx-f_iyrumSDTofWmVWjYs"

# Sign in as superadmin
$signInBody = '{"email":"jorgejara2014@gmail.com","password":"12345678","returnSecureToken":true}'
$signInResult = Invoke-WebRequest -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$apiKey" -Method POST -ContentType "application/json" -Body $signInBody -UseBasicParsing | ConvertFrom-Json
$idToken = $signInResult.idToken
Write-Host "Signed in as: $($signInResult.email) (uid=$($signInResult.localId))"

$headers = @{ Authorization = "Bearer $idToken" }
$baseUrl = "https://firestore.googleapis.com/v1/projects/alquileres-la-casona/databases/(default)/documents"

# Collections to backup
$collections = @(
    "users", "properties", "tenants", "charges", "payments",
    "paymentReceipts", "rentReceipts", "utilityBills", "messages",
    "settings", "tenantInvitations", "paymentAccessTokens",
    "auditLogs", "rentAdjustments", "rentAdjustmentPolicies"
)

$backup = @{
    project = "alquileres-la-casona"
    exportedAt = (Get-Date).ToString("o")
    collections = @{}
}

$totalDocs = 0

foreach ($col in $collections) {
    Write-Host "Fetching collection: $col ..." -NoNewline
    $allDocs = @()
    $pageToken = $null
    $docCount = 0

    do {
        $url = "$baseUrl/$col"
        if ($pageToken) {
            $url += "?pageToken=$pageToken"
        }

        try {
            $response = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 30 | ConvertFrom-Json
        } catch {
            Write-Host " ERROR $($_.Exception.Response.StatusCode.value__)"
            break
        }

        if ($response.documents) {
            foreach ($doc in $response.documents) {
                $docId = $doc.name -replace ".*/", ""
                $allDocs += @{
                    id = $docId
                    data = $doc.fields
                    name = $doc.name
                }
                $docCount++
            }
        }

        $pageToken = $response.nextPageToken
    } while ($pageToken)

    Write-Host " $docCount docs"
    $backup.collections[$col] = $allDocs
    $totalDocs += $docCount
}

# Save backup
$backupDir = "C:\Users\JorgeHaraDevs\Desktop\Dev\jorgehara\Alquileres-La-Casona\backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }

$backupPath = "$backupDir\firestore-production-backup-2026-08-15.json"
$backup | ConvertTo-Json -Depth 10 | Out-File -FilePath $backupPath -Encoding utf8

$fileSize = (Get-Item $backupPath).Length
Write-Host "`n=== BACKUP COMPLETE ==="
Write-Host "Total documents: $totalDocs"
Write-Host "File: $backupPath"
Write-Host "Size: $([math]::Round($fileSize / 1KB, 1)) KB"
