document.addEventListener("DOMContentLoaded", async () => {
  const autoUngroupToggle = document.getElementById("autoUngroupSingle");
  const autoNameToggle = document.getElementById("autoNameGroup");

  // 保存されている設定を読み込み
  const { autoUngroupSingle, autoNameGroup } = await chrome.storage.sync.get({
    autoUngroupSingle: true,
    autoNameGroup: false
  });

  autoUngroupToggle.checked = autoUngroupSingle;
  autoNameToggle.checked = autoNameGroup;

  // 設定変更時の保存
  autoUngroupToggle.addEventListener("change", async (e) => {
    await chrome.storage.sync.set({
      autoUngroupSingle: e.target.checked
    });
  });

  autoNameToggle.addEventListener("change", async (e) => {
    await chrome.storage.sync.set({
      autoNameGroup: e.target.checked
    });
  });
});

