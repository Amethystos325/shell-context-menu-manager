menu(title="Tools", mode=multiple) {
  item(title="PowerShell", cmd="powershell.exe", args="-NoExit -Command Set-Location @sel.dir")
  separator
  menu(title="Convert") {
    item(title="To PNG", cmd="convert.exe", args="\"@sel.path\" \"@sel.dir\\@sel.file.title.png\"")
  }
}
