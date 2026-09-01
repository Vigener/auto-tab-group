document.addEventListener("DOMContentLoaded", async () => {
  const autoNameToggle = document.getElementById("autoNameGroup");

  // 保存されている設定を読み込み（デフォルト: false）
  const { autoNameGroup } = await chrome.storage.sync.get({ autoNameGroup: false });
  autoNameToggle.checked = autoNameGroup;

  // 設定変更時の保存
  autoNameToggle.addEventListener("change", async (e) => {
    await chrome.storage.sync.set({
      autoNameGroup: e.target.checked
    });
  });
});
