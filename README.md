# Disk & RAM Monitor — GNOME Shell Extension

Extensión para GNOME Shell (45 / 46 / 47 / 48 / 49 / 50) que agrega un ícono en el panel
superior. Al hacer clic despliega un menú con dos barras horizontales tipo
medidor que muestran, en tiempo real:

- **Capacidad de Disco** (partición raíz `/`): usado / libre / total.
- **Capacidad de Memoria** (RAM): usado / libre / total.

La barra completa representa el 100% de la capacidad; la parte de color es lo
utilizado y la parte blanca lo libre. Los valores se muestran siempre, sobre
toda la barra, y la información se actualiza cada pocos segundos.

## Instalación

### Opción A — desde el archivo `.zip`

```bash
gnome-extensions install --force disk-ram-monitor@felipe.zip
gnome-extensions enable disk-ram-monitor@felipe
```

Luego reinicia GNOME Shell:

- **Wayland:** cierra sesión y vuelve a entrar (obligatorio; no se puede recargar en caliente).
- **X11:** `Alt`+`F2`, escribe `r`, Enter.

### Opción B — copiando los archivos

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/disk-ram-monitor@felipe
cp -r metadata.json extension.js stylesheet.css \
  ~/.local/share/gnome-shell/extensions/disk-ram-monitor@felipe/
gnome-extensions enable disk-ram-monitor@felipe
```

…y reinicia GNOME Shell como se indica arriba.

## Compatibilidad

Requiere GNOME Shell 45 o superior (usa módulos ESM). Comprueba tu versión con:

```bash
gnome-shell --version
```

## Configuración

Algunos valores se pueden ajustar al inicio de `extension.js`:

- `REFRESH_SECONDS` — frecuencia de actualización (por defecto 3 s).
- `BAR_WIDTH` — ancho de las barras en píxeles.

Los colores están en `stylesheet.css`.

## Licencia

MIT — ver [LICENSE](LICENSE).
