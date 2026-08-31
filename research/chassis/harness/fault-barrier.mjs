export async function holdAfterExternalEffectIfRequested() {
  if (process.env.NAIA_HOLD_AFTER_EXTERNAL_EFFECT !== '1') return;
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
}
