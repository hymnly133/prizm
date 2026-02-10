# Prizm - Kill process using port
# Usage: .\scripts\kill-port.ps1 [port]
# Example: .\scripts\kill-port.ps1 4127

param(
    [int]$Port = 4127
)

$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

if ($connections) {
    $pids = $connections.OwningProcess | Sort-Object -Unique
    foreach ($procId in $pids) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $procId -Force
                Write-Host "Killed process $procId ($($proc.ProcessName))"
            }
        } catch {
            Write-Warning "Failed to kill process $procId : $_"
        }
    }
    Write-Host "Port $Port freed"
} else {
    Write-Host "Port $Port is not in use"
}
