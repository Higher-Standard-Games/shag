import { PackageDownload } from "../loader/pk3/PackageDownload";
import "./components/styles/PackageDownloadStatus.css";

interface DownloadRow {
  root: HTMLElement;
  label: HTMLElement;
  size: HTMLElement;
  speed: HTMLElement;
  bar: HTMLElement;
}

/** A transfer panel whose polling lives only as long as its loading screen. */
export class PackageDownloadStatus {
  readonly root = document.createElement("section");
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly rows = new Map<PackageDownload, DownloadRow>();
  private readonly more = node("div", "package-downloads__more");

  constructor() {
    this.root.className = "package-downloads";
    this.root.setAttribute("aria-label", "Package downloads");
    this.root.append(this.more);
    this.render();
    this.timer = setInterval(() => this.render(), 250);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.root.remove();
    this.rows.clear();
  }

  private render(): void {
    const downloads = PackageDownload.getActive();
    this.root.hidden = downloads.length === 0;
    const visible = downloads.slice(0, 3);
    for (const [download, row] of this.rows) {
      if (visible.includes(download)) continue;
      row.root.remove();
      this.rows.delete(download);
    }
    for (const download of visible) {
      const row = this.rows.get(download) ?? this.createRow(download);
      row.label.textContent = download.phase;
      const loaded = `${(download.loaded / 1_000_000).toFixed(1)} MB`;
      const size =
        download.total === null ? `${loaded} received` : `${loaded} / ${(download.total / 1_000_000).toFixed(1)} MB`;
      row.size.textContent = size;
      row.speed.hidden = download.phase !== "Downloading";
      row.speed.textContent = `${(download.bytesPerSecond() / 1_000_000).toFixed(1)} MB/s`;
      const bar = row.bar;
      bar.setAttribute("aria-label", `${download.phase} ${download.filename}`);
      bar.setAttribute("aria-valuetext", size);
      bar.classList.toggle("package-downloads__bar--unknown", download.total === null);
      if (download.total !== null) {
        const percent = Math.min(100, (download.loaded / download.total) * 100);
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(Math.round(percent)));
        bar.style.setProperty("--download-progress", `${percent}%`);
      } else {
        bar.removeAttribute("aria-valuenow");
        bar.removeAttribute("aria-valuemin");
        bar.removeAttribute("aria-valuemax");
      }
    }
    const remaining = Math.max(0, downloads.length - 3);
    this.more.hidden = remaining === 0;
    this.more.textContent =
      remaining > 0 ? `+ ${remaining} more ${remaining === 1 ? "package" : "packages"} downloading` : "";
  }

  private createRow(download: PackageDownload): DownloadRow {
    const root = node("div", "package-downloads__row");
    const header = node("div", "package-downloads__header");
    const label = node("span", "package-downloads__label", download.phase);
    const name = node("strong", "package-downloads__name", download.filename);
    name.title = download.filename;
    header.append(label, name);
    const stats = node("div", "package-downloads__stats");
    const size = node("span", "");
    const speed = node("strong", "package-downloads__speed");
    stats.append(size, speed);
    const bar = node("div", "package-downloads__bar");
    bar.setAttribute("role", "progressbar");
    bar.append(node("div", "package-downloads__fill"));
    root.append(header, stats, bar);
    this.root.insertBefore(root, this.more);
    const row = { root, label, size, speed, bar };
    this.rows.set(download, row);
    return row;
  }
}

function node(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
