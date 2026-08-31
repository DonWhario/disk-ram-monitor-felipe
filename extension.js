/* extension.js
 *
 * Disk & RAM Monitor — GNOME Shell 45/46/47/48 (ESM)
 *
 * Añade un indicador en el panel superior que, al hacer clic, despliega un
 * menú con dos barras horizontales tipo medidor:
 *   - Capacidad del Disco (montaje /): usado / total
 *   - Capacidad de la RAM: usado / total
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_SECONDS = 3;      // cada cuánto se actualizan los datos
const BAR_WIDTH = 230;          // ancho de la barra en píxeles

// ---- Utilidades -----------------------------------------------------------

// Convierte bytes a GiB (base 1024) con 1 decimal.
function toGiB(bytes) {
    return bytes / (1024 * 1024 * 1024);
}

function fmtGiB(bytes) {
    const v = toGiB(bytes);
    // Sin decimal si es un valor "redondo"
    if (Math.abs(v - Math.round(v)) < 0.05)
        return `${Math.round(v)} GiB`;
    return `${v.toFixed(1)} GiB`;
}

// Lee tamaño total/usado del sistema de archivos raíz "/".
function readDisk() {
    try {
        const file = Gio.File.new_for_path('/');
        const info = file.query_filesystem_info(
            'filesystem::size,filesystem::used,filesystem::free', null);

        const total = info.get_attribute_uint64('filesystem::size');
        let used = 0;
        if (info.has_attribute('filesystem::used')) {
            used = info.get_attribute_uint64('filesystem::used');
        } else {
            const free = info.get_attribute_uint64('filesystem::free');
            used = total - free;
        }
        return {total, used};
    } catch (e) {
        logError(e, 'disk-ram-monitor: no se pudo leer el disco');
        return {total: 0, used: 0};
    }
}

// Lee memoria total/usada desde /proc/meminfo (valores en kB).
function readRam() {
    try {
        const [ok, contents] = GLib.file_get_contents('/proc/meminfo');
        if (!ok)
            return {total: 0, used: 0};

        const text = new TextDecoder().decode(contents);
        const map = {};
        for (const line of text.split('\n')) {
            const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
            if (m)
                map[m[1]] = parseInt(m[2], 10) * 1024; // a bytes
        }
        const total = map['MemTotal'] || 0;
        // MemAvailable es la mejor estimación de lo realmente disponible.
        const available = (map['MemAvailable'] !== undefined)
            ? map['MemAvailable']
            : (map['MemFree'] || 0) + (map['Buffers'] || 0) + (map['Cached'] || 0);
        const used = Math.max(0, total - available);
        return {total, used};
    } catch (e) {
        logError(e, 'disk-ram-monitor: no se pudo leer la RAM');
        return {total: 0, used: 0};
    }
}

// ---- Widget de una fila (nombre + barra + total) --------------------------

const MeterRow = GObject.registerClass(
class MeterRow extends St.BoxLayout {
    _init(name) {
        super._init({
            style_class: 'drm-row',
            vertical: false,
            x_expand: true,
        });

        // Etiqueta con el nombre de la métrica.
        this._name = new St.Label({
            text: name,
            style_class: 'drm-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._name);

        // Contenedor de la barra: ancho fijo = 100% del total. Usa dos capas
        // superpuestas (BinLayout):
        //   - Capa de color: cajas "usado" (color) + "libre" (blanco).
        //   - Capa de texto: los números flotan sobre TODA la barra, por lo que
        //     siempre se ven completos, sin importar si quedan sobre el color o
        //     sobre el blanco.
        this._barBg = new St.Widget({
            style_class: 'drm-bar-bg',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            width: BAR_WIDTH,
            clip_to_allocation: true,
        });

        // --- Capa 1: proporción de color -----------------------------------
        const colorLayer = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
        });
        this._fillBox = new St.BoxLayout({
            style_class: 'drm-bar-fill',
            x_expand: false,
            y_expand: true,
        });
        this._restBox = new St.BoxLayout({
            style_class: 'drm-bar-rest',
            x_expand: true,
            y_expand: true,
        });
        colorLayer.add_child(this._fillBox);
        colorLayer.add_child(this._restBox);

        // --- Capa 2: textos (encima del color) -----------------------------
        const textLayer = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
        });
        this._usedLabel = new St.Label({
            text: '',
            style_class: 'drm-used-text',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._freeLabel = new St.Label({
            text: '',
            style_class: 'drm-free-text',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        textLayer.add_child(this._usedLabel);
        textLayer.add_child(this._freeLabel);

        this._barBg.add_child(colorLayer);   // debajo
        this._barBg.add_child(textLayer);    // encima
        this.add_child(this._barBg);

        // Total como texto suelto a la derecha (fuera de la barra).
        this._totalBox = new St.Label({
            text: '',
            style_class: 'drm-total-text',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._totalBox);
    }

    update(used, total) {
        const fraction = total > 0 ? Math.min(1, used / total) : 0;
        const free = Math.max(0, total - used);

        // Ancho interior real de la barra (descontando el borde de 1px).
        const inner = BAR_WIDTH - 2;
        const fillWidth = Math.round(fraction * inner);
        this._fillBox.width = fillWidth;

        // Los números se muestran SIEMPRE, completos, sobre toda la barra.
        this._usedLabel.text = fmtGiB(used);
        this._freeLabel.text = fmtGiB(free);
        this._totalBox.text = fmtGiB(total);

        // Color de alerta cuando el uso es alto.
        this._fillBox.remove_style_class_name('drm-warn');
        this._fillBox.remove_style_class_name('drm-crit');
        if (fraction >= 0.9)
            this._fillBox.add_style_class_name('drm-crit');
        else if (fraction >= 0.75)
            this._fillBox.add_style_class_name('drm-warn');
    }
});

// ---- Indicador del panel ---------------------------------------------------

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Disk & RAM Monitor', false);

        // Ícono en el panel.
        this._icon = new St.Icon({
            icon_name: 'drive-harddisk-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // Encabezado del menú.
        const title = new PopupMenu.PopupMenuItem('Uso del sistema', {
            reactive: false,
            can_focus: false,
        });
        title.label.add_style_class_name('drm-title');
        this.menu.addMenuItem(title);

        // Filas de disco y RAM dentro de un item no-reactivo.
        const container = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'drm-box'});

        this._diskRow = new MeterRow('Capacidad de Disco');
        this._ramRow = new MeterRow('Capacidad de Memoria');
        box.add_child(this._diskRow);
        box.add_child(this._ramRow);

        container.add_child(box);
        this.menu.addMenuItem(container);

        // Refrescar al abrir el menú.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refresh();
        });
    }

    _refresh() {
        const disk = readDisk();
        const ram = readRam();
        this._diskRow.update(disk.used, disk.total);
        this._ramRow.update(ram.used, ram.total);
    }
});

// ---- Extensión -------------------------------------------------------------

export default class DiskRamMonitorExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator._refresh();

        // Actualización periódica en segundo plano.
        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
                this._indicator._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    disable() {
        if (this._timeout) {
            GLib.Source.remove(this._timeout);
            this._timeout = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
