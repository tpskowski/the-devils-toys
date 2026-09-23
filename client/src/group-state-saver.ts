/** A queue owns its revision, including after the page that created it leaves. */
export function createGroupStateSaver(
  write: (state: Record<string, unknown>, revision: number) => Promise<{ revision: number }>
) {
  let revision = 0;
  let chain = Promise.resolve();
  return {
    readRevision(value: number) {
      revision = value;
    },
    save(state: Record<string, unknown>) {
      const saved = chain.then(async () => {
        revision = (await write(state, revision)).revision;
      });
      // A failed request remains visible to its caller; later retries can run.
      chain = saved.catch(() => undefined);
      return saved;
    }
  };
}
