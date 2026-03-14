import * as vscode from "vscode";

export class Logger {
  private channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("Symtrace");
  }

  info(msg: string): void {
    this.channel.appendLine(`[INFO] ${new Date().toISOString()} ${msg}`);
  }

  warn(msg: string): void {
    this.channel.appendLine(`[WARN] ${new Date().toISOString()} ${msg}`);
  }

  error(msg: string): void {
    this.channel.appendLine(`[ERROR] ${new Date().toISOString()} ${msg}`);
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}
