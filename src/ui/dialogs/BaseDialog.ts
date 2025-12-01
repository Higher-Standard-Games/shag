export abstract class BaseDialog {
    protected element: HTMLElement | null = null;

    constructor(public id: string) { }

    public abstract getHTML(context: any): string;

    public show(context: any): void {
        if (this.element) return; // Already open

        this.element = document.createElement("div");
        this.element.id = `dialog-${this.id}`;
        this.element.className = "game-dialog";
        this.element.innerHTML = this.getHTML(context);

        // Add close button logic if needed, or handle in getHTML
        // For now, simple append
        document.body.appendChild(this.element);

        this.onOpen(context);
    }

    public hide(): void {
        if (this.element) {
            this.element.remove();
            this.element = null;
            this.onClose();
        }
    }

    protected onOpen(context: any): void { }
    protected onClose(): void { }
}
