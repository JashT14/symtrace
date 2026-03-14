import * as vscode from "vscode";
import * as cp from "child_process";

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface CommitPair {
  commitA: string;
  commitB: string;
}

export async function pickTwoCommits(
  repoPath: string
): Promise<CommitPair | undefined> {
  const commits = await getRecentCommits(repoPath, 50);
  if (commits.length < 2) {
    vscode.window.showWarningMessage("Not enough commits in this repository.");
    return undefined;
  }

  const commitA = await showCommitPicker(
    commits,
    "Select the OLDER commit (base)"
  );
  if (!commitA) {
    return undefined;
  }

  const commitB = await showCommitPicker(
    commits.filter((c) => c.hash !== commitA.hash),
    "Select the NEWER commit (target)"
  );
  if (!commitB) {
    return undefined;
  }

  return { commitA: commitA.hash, commitB: commitB.hash };
}

export async function pickCommitWithParent(
  repoPath: string
): Promise<CommitPair | undefined> {
  const commits = await getRecentCommits(repoPath, 50);
  if (commits.length < 1) {
    vscode.window.showWarningMessage("No commits found in this repository.");
    return undefined;
  }

  const commit = await showCommitPicker(
    commits,
    "Select a commit to compare with its parent"
  );
  if (!commit) {
    return undefined;
  }

  return { commitA: `${commit.hash}~1`, commitB: commit.hash };
}

async function getRecentCommits(
  repoPath: string,
  count: number
): Promise<CommitInfo[]> {
  return new Promise((resolve) => {
    const format = "%H%x00%h%x00%s%x00%an%x00%ar";
    cp.exec(
      `git log -${count} --format="${format}"`,
      { cwd: repoPath, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const commits = stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => {
            const [hash, shortHash, subject, author, date] = line.split("\0");
            return { hash, shortHash, subject, author, date };
          });
        resolve(commits);
      }
    );
  });
}

async function showCommitPicker(
  commits: CommitInfo[],
  title: string
): Promise<CommitInfo | undefined> {
  const items: (vscode.QuickPickItem & { commit: CommitInfo })[] = commits.map(
    (c) => ({
      label: `$(git-commit) ${c.shortHash}`,
      description: c.subject,
      detail: `${c.author}, ${c.date}`,
      commit: c,
    })
  );

  const selected = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: "Type to filter commits...",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return selected?.commit;
}
