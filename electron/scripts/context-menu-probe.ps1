param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("background", "item")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [switch]$Shift
)

$ErrorActionPreference = "Stop"

$typeLoaded = [AppDomain]::CurrentDomain.GetAssemblies().GetTypes().Name -contains "ShellContextMenuProbe"
if (-not $typeLoaded) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class MenuEntry {
  public string Title { get; set; }
  public bool Submenu { get; set; }
  public bool Disabled { get; set; }
  public List<MenuEntry> Children { get; set; }
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("000214E6-0000-0000-C000-000000000046")]
internal interface IShellFolder {
  [PreserveSig] int ParseDisplayName(IntPtr hwnd, IntPtr pbc, [MarshalAs(UnmanagedType.LPWStr)] string pszDisplayName, ref uint pchEaten, out IntPtr ppidl, ref uint pdwAttributes);
  [PreserveSig] int EnumObjects(IntPtr hwnd, int grfFlags, out IntPtr ppenumIDList);
  [PreserveSig] int BindToObject(IntPtr pidl, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
  [PreserveSig] int BindToStorage(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
  [PreserveSig] int CompareIDs(int lParam, IntPtr pidl1, IntPtr pidl2);
  [PreserveSig] int CreateViewObject(IntPtr hwndOwner, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
  [PreserveSig] int GetAttributesOf(uint cidl, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex=0)] IntPtr[] apidl, ref uint rgfInOut);
  [PreserveSig] int GetUIObjectOf(IntPtr hwndOwner, uint cidl, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex=1)] IntPtr[] apidl, ref Guid riid, IntPtr rgfReserved, out IntPtr ppv);
  [PreserveSig] int GetDisplayNameOf(IntPtr pidl, uint uFlags, out IntPtr pName);
  [PreserveSig] int SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string pszName, uint uFlags, out IntPtr ppidlOut);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("000214E4-0000-0000-C000-000000000046")]
internal interface IContextMenu {
  [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
  [PreserveSig] int InvokeCommand(IntPtr pici);
  [PreserveSig] int GetCommandString(UIntPtr idCmd, uint uFlags, uint pReserved, [MarshalAs(UnmanagedType.LPStr)] StringBuilder pszName, int cchMax);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("000214F4-0000-0000-C000-000000000046")]
internal interface IContextMenu2 {
  [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
  [PreserveSig] int InvokeCommand(IntPtr pici);
  [PreserveSig] int GetCommandString(UIntPtr idCmd, uint uFlags, uint pReserved, [MarshalAs(UnmanagedType.LPStr)] StringBuilder pszName, int cchMax);
  [PreserveSig] int HandleMenuMsg(uint uMsg, IntPtr wParam, IntPtr lParam);
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719")]
internal interface IContextMenu3 {
  [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
  [PreserveSig] int InvokeCommand(IntPtr pici);
  [PreserveSig] int GetCommandString(UIntPtr idCmd, uint uFlags, uint pReserved, [MarshalAs(UnmanagedType.LPStr)] StringBuilder pszName, int cchMax);
  [PreserveSig] int HandleMenuMsg(uint uMsg, IntPtr wParam, IntPtr lParam);
  [PreserveSig] int HandleMenuMsg2(uint uMsg, IntPtr wParam, IntPtr lParam, out IntPtr plResult);
}

internal static class NativeMethods {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  internal static extern int SHParseDisplayName(string name, IntPtr pbc, out IntPtr pidl, uint sfgaoIn, out uint psfgaoOut);

  [DllImport("shell32.dll", PreserveSig = true)]
  internal static extern int SHBindToParent(IntPtr pidl, ref Guid riid, out IntPtr ppv, out IntPtr ppidlLast);

  [DllImport("shell32.dll")]
  internal static extern void ILFree(IntPtr pidl);

  [DllImport("user32.dll")]
  internal static extern IntPtr CreatePopupMenu();

  [DllImport("user32.dll")]
  internal static extern bool DestroyMenu(IntPtr hMenu);

  [DllImport("user32.dll")]
  internal static extern int GetMenuItemCount(IntPtr hMenu);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  internal static extern int GetMenuString(IntPtr hMenu, uint uIDItem, StringBuilder lpString, int cchMax, uint flags);

  [DllImport("user32.dll")]
  internal static extern uint GetMenuState(IntPtr hMenu, uint uId, uint uFlags);

  [DllImport("user32.dll")]
  internal static extern IntPtr GetSubMenu(IntPtr hMenu, int nPos);
}

public static class ShellContextMenuProbe {
  private const uint CMF_NORMAL = 0x00000000;
  private const uint CMF_EXTENDEDVERBS = 0x00000100;
  private const uint MF_BYPOSITION = 0x00000400;
  private const uint MF_GRAYED = 0x00000001;
  private const uint MF_DISABLED = 0x00000002;
  private const uint MF_SEPARATOR = 0x00000800;
  private const uint WM_INITMENUPOPUP = 0x0117;

  private static readonly Guid IID_IShellFolder = new Guid("000214E6-0000-0000-C000-000000000046");
  private static readonly Guid IID_IContextMenu = new Guid("000214E4-0000-0000-C000-000000000046");

  public static List<MenuEntry> ProbeBackground(string targetPath, bool includeExtended) {
    IntPtr pidl = IntPtr.Zero;
    IntPtr parentPtr = IntPtr.Zero;
    IntPtr childPidl = IntPtr.Zero;
    object folderObj = null;
    object contextMenuObj = null;
    try {
      uint attrs = 0;
      int hr = NativeMethods.SHParseDisplayName(targetPath, IntPtr.Zero, out pidl, 0, out attrs);
      Marshal.ThrowExceptionForHR(hr);

      Guid iidShellFolder = IID_IShellFolder;
      hr = NativeMethods.SHBindToParent(pidl, ref iidShellFolder, out parentPtr, out childPidl);
      Marshal.ThrowExceptionForHR(hr);

      var parent = (IShellFolder)Marshal.GetObjectForIUnknown(parentPtr);
      iidShellFolder = IID_IShellFolder;
      hr = parent.BindToObject(childPidl, IntPtr.Zero, ref iidShellFolder, out folderObj);
      Marshal.ThrowExceptionForHR(hr);

      var folder = (IShellFolder)folderObj;
      Guid iidContextMenu = IID_IContextMenu;
      hr = folder.CreateViewObject(IntPtr.Zero, ref iidContextMenu, out contextMenuObj);
      Marshal.ThrowExceptionForHR(hr);

      return QueryMenu((IContextMenu)contextMenuObj, includeExtended);
    } finally {
      if (contextMenuObj != null) Marshal.ReleaseComObject(contextMenuObj);
      if (folderObj != null) Marshal.ReleaseComObject(folderObj);
      if (parentPtr != IntPtr.Zero) Marshal.Release(parentPtr);
      if (pidl != IntPtr.Zero) NativeMethods.ILFree(pidl);
    }
  }

  public static List<MenuEntry> ProbeItem(string targetPath, bool includeExtended) {
    IntPtr pidl = IntPtr.Zero;
    IntPtr parentPtr = IntPtr.Zero;
    IntPtr childPidl = IntPtr.Zero;
    IntPtr cmPtr = IntPtr.Zero;
    object contextMenuObj = null;
    try {
      uint attrs = 0;
      int hr = NativeMethods.SHParseDisplayName(targetPath, IntPtr.Zero, out pidl, 0, out attrs);
      Marshal.ThrowExceptionForHR(hr);

      Guid iidShellFolder = IID_IShellFolder;
      hr = NativeMethods.SHBindToParent(pidl, ref iidShellFolder, out parentPtr, out childPidl);
      Marshal.ThrowExceptionForHR(hr);

      var parent = (IShellFolder)Marshal.GetObjectForIUnknown(parentPtr);
      var pidls = new[] { childPidl };
      Guid iidContextMenu = IID_IContextMenu;
      hr = parent.GetUIObjectOf(IntPtr.Zero, 1, pidls, ref iidContextMenu, IntPtr.Zero, out cmPtr);
      Marshal.ThrowExceptionForHR(hr);

      contextMenuObj = Marshal.GetObjectForIUnknown(cmPtr);
      return QueryMenu((IContextMenu)contextMenuObj, includeExtended);
    } finally {
      if (contextMenuObj != null) Marshal.ReleaseComObject(contextMenuObj);
      if (cmPtr != IntPtr.Zero) Marshal.Release(cmPtr);
      if (parentPtr != IntPtr.Zero) Marshal.Release(parentPtr);
      if (pidl != IntPtr.Zero) NativeMethods.ILFree(pidl);
    }
  }

  private static List<MenuEntry> QueryMenu(IContextMenu contextMenu, bool includeExtended) {
    IntPtr hMenu = NativeMethods.CreatePopupMenu();
    if (hMenu == IntPtr.Zero) {
      return new List<MenuEntry>();
    }

    try {
      uint flags = CMF_NORMAL | (includeExtended ? CMF_EXTENDEDVERBS : 0);
      int hr = contextMenu.QueryContextMenu(hMenu, 0, 1, 0x7FFF, flags);
      Marshal.ThrowExceptionForHR(hr);

      var cm2 = contextMenu as IContextMenu2;
      var cm3 = contextMenu as IContextMenu3;
      return ExtractMenuEntries(hMenu, cm2, cm3, 0);
    } finally {
      NativeMethods.DestroyMenu(hMenu);
    }
  }

  private static List<MenuEntry> ExtractMenuEntries(IntPtr hMenu, IContextMenu2 cm2, IContextMenu3 cm3, int depth) {
    int count = NativeMethods.GetMenuItemCount(hMenu);
    var output = new List<MenuEntry>();
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    for (int i = 0; i < count; i++) {
      uint state = NativeMethods.GetMenuState(hMenu, (uint)i, MF_BYPOSITION);
      if ((state & MF_SEPARATOR) != 0) {
        continue;
      }

      var sb = new StringBuilder(512);
      NativeMethods.GetMenuString(hMenu, (uint)i, sb, sb.Capacity, MF_BYPOSITION);
      string title = NormalizeTitle(sb.ToString());
      if (string.IsNullOrWhiteSpace(title)) {
        continue;
      }
      if (!seen.Add(title)) {
        continue;
      }

      IntPtr subMenu = NativeMethods.GetSubMenu(hMenu, i);
      bool hasSubmenu = subMenu != IntPtr.Zero;
      var entry = new MenuEntry {
        Title = title,
        Submenu = hasSubmenu,
        Disabled = (state & (MF_GRAYED | MF_DISABLED)) != 0,
        Children = new List<MenuEntry>(),
      };

      if (hasSubmenu && depth < 2) {
        NotifyInitMenuPopup(cm2, cm3, subMenu, i);
        entry.Children = ExtractMenuEntries(subMenu, cm2, cm3, depth + 1);
      }
      output.Add(entry);
    }
    return output;
  }

  private static void NotifyInitMenuPopup(IContextMenu2 cm2, IContextMenu3 cm3, IntPtr hSubMenu, int position) {
    IntPtr wParam = hSubMenu;
    IntPtr lParam = (IntPtr)(position & 0xFFFF);
    if (cm3 != null) {
      IntPtr result;
      cm3.HandleMenuMsg2(WM_INITMENUPOPUP, wParam, lParam, out result);
      return;
    }
    if (cm2 != null) {
      cm2.HandleMenuMsg(WM_INITMENUPOPUP, wParam, lParam);
    }
  }

  private static string NormalizeTitle(string raw) {
    if (string.IsNullOrWhiteSpace(raw)) {
      return string.Empty;
    }
    var text = raw.Replace("&", "").Trim();
    if (text == "-") {
      return string.Empty;
    }
    return text;
  }
}
"@ -Language CSharp
}

if (($TargetPath -notmatch '^(shell:|::)') -and -not (Test-Path -LiteralPath $TargetPath)) {
  throw "TargetPath does not exist: $TargetPath"
}

$entries = if ($Mode -eq "background") {
  [ShellContextMenuProbe]::ProbeBackground($TargetPath, $Shift.IsPresent)
} else {
  [ShellContextMenuProbe]::ProbeItem($TargetPath, $Shift.IsPresent)
}

$entries | ConvertTo-Json -Depth 4
