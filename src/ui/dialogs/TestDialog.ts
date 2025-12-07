import { BaseDialog, type DialogContext } from "./BaseDialog";

export class TestDialog extends BaseDialog {
  constructor() {
    super("test_dialog", {
      title: "Test Dialog",
    });
  }

  public getBodyHTML(context: DialogContext): string {
    const properties = JSON.stringify(context, null, 2);

    return `
      <p style="margin-top: 0;">
        This is a test dialog triggered by clicking on a brush entity.
      </p>
      <pre style="
        background: rgba(0, 0, 0, 0.3);
        padding: 12px;
        border-radius: 6px;
        overflow: auto;
        font-size: 0.85rem;
        color: #a0a0a0;
        border: 1px solid rgba(255, 255, 255, 0.1);
      ">${properties}</pre>
    `;
  }

  protected getTitle(context: DialogContext): string {
    return (context.message as string) || this.options.title;
  }
}
