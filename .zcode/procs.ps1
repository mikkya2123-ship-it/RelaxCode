Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
  $cl = $_.CommandLine
  if ($cl.Length -gt 110) { $cl = $cl.Substring(0,110) }
  "{0} p={1} cpu={2} :: {3}" -f $_.ProcessId, $_.ParentProcessId, (Get-Process -Id $_.ProcessId).CPU, $cl
}
