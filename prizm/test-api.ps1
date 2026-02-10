# Prizm Server API 测试脚本
# PowerShell 脚本

Write-Host "=== Prizm Server API Tests ===" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://127.0.0.1:4127"

# 1. 健康检查
Write-Host "1. Health Check" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
Write-Host "   Status: $($response.status)" -ForegroundColor Green
Write-Host ""

# 2. 创建便签
Write-Host "2. Create Note" -ForegroundColor Yellow
$body = @{
    content = "测试便签内容"
} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$baseUrl/notes" -Method Post -Body $body -ContentType "application/json"
Write-Host "   Created note ID: $($response.note.id)" -ForegroundColor Green
$noteId = $response.note.id
Write-Host ""

# 3. 获取所有便签
Write-Host "3. Get All Notes" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/notes" -Method Get
Write-Host "   Total notes: $($response.notes.Count)" -ForegroundColor Green
Write-Host ""

# 4. 获取单条便签
Write-Host "4. Get Note by ID" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/notes/$noteId" -Method Get
Write-Host "   Note content: $($response.note.content)" -ForegroundColor Green
Write-Host ""

# 5. 更新便签
Write-Host "5. Update Note" -ForegroundColor Yellow
$body = @{
    content = "更新后的便签内容"
} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$baseUrl/notes/$noteId" -Method Patch -Body $body -ContentType "application/json"
Write-Host "   Updated content: $($response.note.content)" -ForegroundColor Green
Write-Host ""

# 6. 创建分组
Write-Host "6. Create Group" -ForegroundColor Yellow
$body = @{
    name = "测试分组"
} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$baseUrl/notes/groups" -Method Post -Body $body -ContentType "application/json"
Write-Host "   Created group ID: $($response.group.id)" -ForegroundColor Green
$groupId = $response.group.id
Write-Host ""

# 7. 获取所有分组
Write-Host "7. Get All Groups" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/notes/groups" -Method Get
Write-Host "   Total groups: $($response.groups.Count)" -ForegroundColor Green
Write-Host ""

# 8. 发送通知
Write-Host "8. Send Notification" -ForegroundColor Yellow
$body = @{
    title = "测试通知"
    body = "这是通知内容"
} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$baseUrl/notify" -Method Post -Body $body -ContentType "application/json"
Write-Host "   Success: $($response.success)" -ForegroundColor Green
Write-Host ""

# 9. SMTC 测试
Write-Host "9. SMTC - Get Current Session" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/smtc/current" -Method Get
Write-Host "   Current session: $($response.session)" -ForegroundColor Green
Write-Host ""

Write-Host "10. SMTC - Play" -ForegroundColor Yellow
$body = @{} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$baseUrl/smtc/play" -Method Post -Body $body -ContentType "application/json"
Write-Host "   Play success: $($response.success)" -ForegroundColor Green
Write-Host ""

# 10. 删除便签
Write-Host "11. Delete Note" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/notes/$noteId" -Method Delete
Write-Host "   Deleted note $noteId" -ForegroundColor Green
Write-Host ""

# 11. 删除分组
Write-Host "12. Delete Group" -ForegroundColor Yellow
Invoke-RestMethod -Uri "$baseUrl/notes/groups/$groupId" -Method Delete
Write-Host "   Deleted group $groupId" -ForegroundColor Green
Write-Host ""

Write-Host "=== All tests completed ===" -ForegroundColor Cyan
