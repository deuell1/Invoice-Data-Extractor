{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.mesa
    pkgs.libxkbcommon
    pkgs.libdrm
    pkgs.cups
    pkgs.alsa-lib
    pkgs.nss
    pkgs.glib
  ];
}
