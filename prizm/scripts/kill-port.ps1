# Prizm - Kill process using port(s)
# Usage: .\scripts\kill-port.ps1 [port ...]
# Example: .\scripts\kill-port.ps1 4127 5183
# Default: kills processes on ports 4127 and 5183

param(
    [int[]]$Port = @(4127, 5183)
)

foreach ($p in $Port) {
    $connections = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue

    if ($connections) {
        $pids = $connections.OwningProcess | Sort-Object -Unique
        foreach ($procId in $pids) {
            try {
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                if ($proc) {
                    Stop-Process -Id $procId -Force
                    Write-Host "Killed process $procId ($($proc.ProcessName)) on port $p"
                }
            } catch {
                Write-Warning "Failed to kill process $procId : $_"
            }
        }
        Write-Host "Port $p freed"
    } else {
        Write-Host "Port $p is not in use"
    }
}
