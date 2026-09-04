$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonScript = Join-Path $project "update_weather.py"
$action = New-ScheduledTaskAction -Execute "py.exe" -Argument "-3 `"$pythonScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At 08:15
Register-ScheduledTask -TaskName "Horvati Vocke - DHMZ vrijeme" -Action $action -Trigger $trigger -Description "Dnevno sprema DHMZ prognozu i oborine za Rakov Potok." -Force
Write-Output "Dnevni DHMZ dohvat je zakazan u 08:15."