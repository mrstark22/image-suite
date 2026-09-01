/**
 * Image Suite — Command-Pattern Undo / Redo History Engine
 * Transaction batching, node-aware memory efficiency, and arbitrary state rollbacks.
 */

export interface Command {
  name: string;
  execute: () => void;
  undo: () => void;
}

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private currentTransaction: Command[] | null = null;
  private maxHistory: number = 60;

  public execute(command: Command): void {
    command.execute();

    if (this.currentTransaction) {
      this.currentTransaction.push(command);
    } else {
      this.undoStack.push(command);
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
  }

  public beginTransaction(_name: string = 'Batch Operation'): void {
    this.currentTransaction = [];
  }

  public commitTransaction(name: string = 'Batch Operation'): void {
    if (!this.currentTransaction || this.currentTransaction.length === 0) {
      this.currentTransaction = null;
      return;
    }

    const batch = [...this.currentTransaction];
    this.currentTransaction = null;

    const compositeCommand: Command = {
      name,
      execute: () => batch.forEach((c) => c.execute()),
      undo: () => {
        for (let i = batch.length - 1; i >= 0; i--) {
          batch[i].undo();
        }
      },
    };

    this.undoStack.push(compositeCommand);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  public cancelTransaction(): void {
    if (!this.currentTransaction) return;
    for (let i = this.currentTransaction.length - 1; i >= 0; i--) {
      this.currentTransaction[i].undo();
    }
    this.currentTransaction = null;
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const command = this.undoStack.pop()!;
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const command = this.redoStack.pop()!;
    command.execute();
    this.undoStack.push(command);
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.currentTransaction = null;
  }
}

export const globalHistory = new HistoryManager();
