// デフォルト設定
const DEFAULT_SETTINGS = {
  autoNameGroup: false // デフォルトは無名（DiaやZenのミニマルな外観に合わせる）
};

// 設定を取得するヘルパー関数
async function getSettings() {
  try {
    return await chrome.storage.sync.get(DEFAULT_SETTINGS);
  } catch (err) {
    console.debug("Failed to get settings, using defaults:", err);
    return DEFAULT_SETTINGS;
  }
}

// 新規タブ作成リスナー
chrome.tabs.onCreated.addListener(async (newTab) => {
  // リンククリック等で作成されたタブ（openerTabIdが存在する）か判定
  if (!newTab.openerTabId || !newTab.id) {
    return;
  }

  try {
    const parentTab = await chrome.tabs.get(newTab.openerTabId);

    // 親タブが存在しない、または別ウィンドウ等の場合はスキップ
    if (!parentTab || parentTab.windowId !== newTab.windowId) {
      return;
    }

    const settings = await getSettings();

    if (parentTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // 親タブがグループ未所属の場合: 親と子の両方を含む新しいグループを作成
      const groupId = await chrome.tabs.group({
        tabIds: [parentTab.id, newTab.id]
      });

      // 自動グループ名付与がONの場合のみタイトルを設定
      if (settings.autoNameGroup && parentTab.title) {
        let groupTitle = parentTab.title.trim();
        if (groupTitle.length > 25) {
          groupTitle = groupTitle.slice(0, 22) + "...";
        }
        await chrome.tabGroups.update(groupId, {
          title: groupTitle
        });
      }
    } else {
      // 親タブが既にグループ所属の場合: 既存グループに子タブを追加
      await chrome.tabs.group({
        groupId: parentTab.groupId,
        tabIds: newTab.id
      });
    }
  } catch (error) {
    // タブが即座に閉じられた場合などの一時的な例外をキャッチ
    console.debug("Auto Tab Group processing error:", error);
  }
});
