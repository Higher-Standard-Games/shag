import { BaseDialog } from "./BaseDialog";
import { UIManager } from "../UIManager";

export class TestDialog extends BaseDialog {
    constructor() {
        super("test_dialog");
    }

    public getHTML(context: any): string {
        const title = context.message || "Test Dialog";
        const properties = JSON.stringify(context, null, 2);

        return `
            <div class="dialog-content" style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9);
                border: 2px solid #0f0;
                color: #0f0;
                padding: 20px;
                font-family: monospace;
                min-width: 300px;
                box-shadow: 0 0 20px rgba(0, 255, 0, 0.2);
            ">
                <h2 style="margin-top: 0; border-bottom: 1px solid #0f0; padding-bottom: 10px;">${title}</h2>
                <pre style="background: #111; padding: 10px; overflow: auto;">${properties}</pre>
                <button id="close-test-dialog" style="
                    background: #0f0;
                    color: #000;
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    font-weight: bold;
                    margin-top: 10px;
                    width: 100%;
                ">CLOSE</button>
            </div>
        `;
    }

    protected onOpen(context: any): void {
        const btn = document.getElementById("close-test-dialog");
        if (btn) {
            btn.onclick = () => UIManager.getInstance().closeDialog(this.id);
        }
    }
}
