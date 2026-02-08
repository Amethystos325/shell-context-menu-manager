param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [int]$X = -1,
  [int]$Y = -1,
  [int]$TimeoutMs = 5000,
  [int]$MenuReadyDelayMs = 180,
  [int]$Padding = 8,
  [int]$DesktopFocusDelayMs = 180,

  [ValidateSet("screen", "menu")]
  [string]$CaptureMode = "screen",

  [ValidateSet("auto", "right-click", "keyboard")]
  [string]$TriggerMode = "auto",

  [switch]$FocusDesktop,
  [switch]$Shift,
  [switch]$KeepMenuOpen
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$typeLoaded = [AppDomain]::CurrentDomain.GetAssemblies().GetTypes().Name -contains "ShellContextMenuCaptureNative"
if (-not $typeLoaded) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ShellContextMenuCaptureNative {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const byte VK_LWIN = 0x5B;
  private const byte VK_M = 0x4D;
  private const byte VK_SHIFT = 0x10;
  private const byte VK_ESCAPE = 0x1B;
  private const byte VK_F10 = 0x79;
  private const byte VK_APPS = 0x5D;

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetCursorPos(out POINT lpPoint);

  [DllImport("user32.dll", SetLastError = false)]
  private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll", SetLastError = false)]
  private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  public static void PressWinD() {
    keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
    keybd_event(0x44, 0, 0, UIntPtr.Zero);
    keybd_event(0x44, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void PressWinM() {
    keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
    keybd_event(VK_M, 0, 0, UIntPtr.Zero);
    keybd_event(VK_M, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void PressEscape() {
    keybd_event(VK_ESCAPE, 0, 0, UIntPtr.Zero);
    keybd_event(VK_ESCAPE, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void KeyDownShift() {
    keybd_event(VK_SHIFT, 0, 0, UIntPtr.Zero);
  }

  public static void KeyUpShift() {
    keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void RightClick() {
    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
  }

  public static void LeftClick() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }

  public static void PressF10() {
    keybd_event(VK_F10, 0, 0, UIntPtr.Zero);
    keybd_event(VK_F10, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void PressAppsKey() {
    keybd_event(VK_APPS, 0, 0, UIntPtr.Zero);
    keybd_event(VK_APPS, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static int[] GetCursorPosition() {
    POINT point;
    if (!GetCursorPos(out point)) {
      return new[] { 0, 0 };
    }
    return new[] { point.X, point.Y };
  }

  public static int[] GetWindowRectArray(IntPtr hWnd) {
    RECT rect;
    if (!GetWindowRect(hWnd, out rect)) {
      return new[] { 0, 0, 0, 0 };
    }
    return new[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
  }

  public static IntPtr FindBestContextMenuWindow(int x, int y) {
    IntPtr bestHandle = IntPtr.Zero;
    long bestScore = long.MaxValue;

    EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) {
        return true;
      }

      var sb = new StringBuilder(64);
      if (GetClassName(hWnd, sb, sb.Capacity) <= 0) {
        return true;
      }
      if (!string.Equals(sb.ToString(), "#32768", StringComparison.Ordinal)) {
        return true;
      }

      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) {
        return true;
      }

      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width < 40 || height < 40) {
        return true;
      }

      int centerX = rect.Left + (width / 2);
      int centerY = rect.Top + (height / 2);
      long dx = centerX - x;
      long dy = centerY - y;
      long score = (dx * dx) + (dy * dy);
      if (score < bestScore) {
        bestScore = score;
        bestHandle = hWnd;
      }
      return true;
    }, IntPtr.Zero);

    return bestHandle;
  }
}
"@ -Language CSharp
}

function Resolve-CapturePoint {
  param(
    [int]$InputX,
    [int]$InputY
  )

  if ($InputX -ge 0 -and $InputY -ge 0) {
    return @{ X = $InputX; Y = $InputY }
  }

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $fallbackX = $bounds.Left + [int]($bounds.Width * 0.72)
  $fallbackY = $bounds.Top + [int]($bounds.Height * 0.55)
  return @{ X = $fallbackX; Y = $fallbackY }
}

function Get-MenuRect {
  param(
    [int]$ClickX,
    [int]$ClickY,
    [int]$Timeout
  )

  $started = [Environment]::TickCount64
  while (($Timeout -le 0) -or (([Environment]::TickCount64 - $started) -lt $Timeout)) {
    $handle = [ShellContextMenuCaptureNative]::FindBestContextMenuWindow($ClickX, $ClickY)
    if ($handle -ne [IntPtr]::Zero) {
      $rect = [ShellContextMenuCaptureNative]::GetWindowRectArray($handle)
      $width = [Math]::Max(0, $rect[2] - $rect[0])
      $height = [Math]::Max(0, $rect[3] - $rect[1])
      if ($width -gt 0 -and $height -gt 0) {
        return @{
          Handle = $handle
          Left = $rect[0]
          Top = $rect[1]
          Right = $rect[2]
          Bottom = $rect[3]
          Width = $width
          Height = $height
        }
      }
    }
    Start-Sleep -Milliseconds 20
  }
  return $null
}

function Save-RectScreenshot {
  param(
    [int]$Left,
    [int]$Top,
    [int]$Width,
    [int]$Height,
    [string]$Path
  )

  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $graphics.CopyFromScreen($Left, $Top, 0, 0, $bmp.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bmp.Dispose()
  }
}

$capturePoint = Resolve-CapturePoint -InputX $X -InputY $Y
$clickX = [int]$capturePoint.X
$clickY = [int]$capturePoint.Y

$resolvedOut = [System.IO.Path]::GetFullPath($OutputPath)
$outDir = [System.IO.Path]::GetDirectoryName($resolvedOut)
if ([string]::IsNullOrWhiteSpace($outDir) -eq $false) {
  [System.IO.Directory]::CreateDirectory($outDir) | Out-Null
}

if ($FocusDesktop.IsPresent) {
  [ShellContextMenuCaptureNative]::PressWinM()
  Start-Sleep -Milliseconds ([Math]::Max(0, $DesktopFocusDelayMs))
}

[ShellContextMenuCaptureNative]::PressEscape()
Start-Sleep -Milliseconds 50

[ShellContextMenuCaptureNative]::SetCursorPos($clickX, $clickY) | Out-Null
Start-Sleep -Milliseconds 40

$openContextMenu = {
  param([string]$mode)
  if ($mode -eq "right-click") {
    if ($Shift.IsPresent) {
      [ShellContextMenuCaptureNative]::KeyDownShift()
    }
    try {
      [ShellContextMenuCaptureNative]::RightClick()
    } finally {
      if ($Shift.IsPresent) {
        [ShellContextMenuCaptureNative]::KeyUpShift()
      }
    }
    return
  }

  if ($mode -eq "keyboard") {
    [ShellContextMenuCaptureNative]::LeftClick()
    Start-Sleep -Milliseconds 60
    if ($Shift.IsPresent) {
      [ShellContextMenuCaptureNative]::KeyDownShift()
      [ShellContextMenuCaptureNative]::PressF10()
      [ShellContextMenuCaptureNative]::KeyUpShift()
    } else {
      [ShellContextMenuCaptureNative]::PressAppsKey()
    }
    return
  }
}

if ($TriggerMode -eq "auto") {
  & $openContextMenu "right-click"
  Start-Sleep -Milliseconds 120
  $probeHandle = [ShellContextMenuCaptureNative]::FindBestContextMenuWindow($clickX, $clickY)
  if ($probeHandle -eq [IntPtr]::Zero) {
    [ShellContextMenuCaptureNative]::PressEscape()
    Start-Sleep -Milliseconds 40
    & $openContextMenu "keyboard"
  }
} else {
  & $openContextMenu $TriggerMode
}

Start-Sleep -Milliseconds ([Math]::Max(0, $MenuReadyDelayMs))

$menuRect = Get-MenuRect -ClickX $clickX -ClickY $clickY -Timeout $TimeoutMs
if (($CaptureMode -eq "menu") -and ($null -eq $menuRect)) {
  [ShellContextMenuCaptureNative]::PressEscape()
  throw "Context menu window (#32768) not found near ($clickX, $clickY) within ${TimeoutMs}ms."
}

if ($null -eq $menuRect) {
  $menuRect = @{
    Handle = [IntPtr]::Zero
    Left = $clickX
    Top = $clickY
    Right = $clickX
    Bottom = $clickY
    Width = 0
    Height = 0
  }
}

$screenBounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$pad = [Math]::Max(0, $Padding)

$left = 0
$top = 0
$right = 0
$bottom = 0

if ($CaptureMode -eq "menu") {
  $left = [Math]::Max($screenBounds.Left, $menuRect.Left - $pad)
  $top = [Math]::Max($screenBounds.Top, $menuRect.Top - $pad)
  $right = [Math]::Min($screenBounds.Right, $menuRect.Right + $pad)
  $bottom = [Math]::Min($screenBounds.Bottom, $menuRect.Bottom + $pad)
} else {
  $left = $screenBounds.Left
  $top = $screenBounds.Top
  $right = $screenBounds.Right
  $bottom = $screenBounds.Bottom
}

$width = [Math]::Max(1, $right - $left)
$height = [Math]::Max(1, $bottom - $top)

Save-RectScreenshot -Left $left -Top $top -Width $width -Height $height -Path $resolvedOut

if (-not $KeepMenuOpen.IsPresent) {
  Start-Sleep -Milliseconds 80
  [ShellContextMenuCaptureNative]::PressEscape()
}

$result = [ordered]@{
  outputPath = $resolvedOut
  captureMode = $CaptureMode
  click = [ordered]@{
    x = $clickX
    y = $clickY
  }
  menuRect = [ordered]@{
    left = $menuRect.Left
    top = $menuRect.Top
    right = $menuRect.Right
    bottom = $menuRect.Bottom
    width = $menuRect.Width
    height = $menuRect.Height
  }
  captureRect = [ordered]@{
    left = $left
    top = $top
    right = $right
    bottom = $bottom
    width = $width
    height = $height
  }
}

$result | ConvertTo-Json -Depth 4
