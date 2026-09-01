// デフォルト設定
const DEFAULT_SETTINGS = {
  autoNameGroup: false,      // 親タイトルをグループ名に適用（デフォルト: OFF）
  autoUngroupSingle: true    // 1タブのみになったらグループ解除（デフォルト: ON）
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

// タブIDごとの直前の所属グループIDを記録するMap（メモリキャッシュ）
const tabGroupMap = new Map();

// 起動時 / Service Worker 起動時に全タブの groupId を同期
async function syncAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      tabGroupMap.set(tab.id, tab.groupId);
    }
  } catch (e) {
    console.debug("Sync tabs error:", e);
  }
}
syncAllTabs();

// タブ作成時の groupId を記録
chrome.tabs.onCreated.addListener((tab) => {
  tabGroupMap.set(tab.id, tab.groupId);
});

// タブの groupId 変更を記録（手動グループ化や移動）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.groupId !== undefined) {
    tabGroupMap.set(tabId, changeInfo.groupId);
  }
});

// ==========================================
// 1. リンククリックによる子タブ生成（グループ化）
// ==========================================
// webNavigation.onCreatedNavigationTarget は、
// ページ内のリンククリック（Cmd+クリック等）や window.open によるタブ作成時のみ発火します。
// （Cmd+T、+ボタン、保存されたグループの展開、タブ復元では発火しません）
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const { sourceTabId, tabId } = details;
  if (!sourceTabId || !tabId) return;

  try {
    const [parentTab, childTab] = await Promise.all([
      chrome.tabs.get(sourceTabId).catch(() => null),
      chrome.tabs.get(tabId).catch(() => null)
    ]);

    // 親タブまたは子タブが存在しない、別ウィンドウの場合はスキップ
    if (!parentTab || !childTab || parentTab.windowId !== childTab.windowId) {
      return;
    }

    const settings = await getSettings();

    if (parentTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // 親タブがグループ未所属の場合: 親と子の両方を含む新しいグループを作成
      const groupId = await chrome.tabs.group({
        tabIds: [parentTab.id, childTab.id]
      });
      tabGroupMap.set(parentTab.id, groupId);
      tabGroupMap.set(childTab.id, groupId);

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
        tabIds: childTab.id
      });
      tabGroupMap.set(childTab.id, parentTab.groupId);
    }
  } catch (error) {
    console.debug("Auto Tab Group navigation target error:", error);
  }
});

// ==========================================
// 2. タブが閉じられたときの 1タブグループ解除
// ==========================================
// タブが明示的に閉じられた（Cmd+W、xボタン等）ときのみ、
// その閉じられたタブが属していた「特定のグループ」だけを検査して解除します。
// （手動作成した1タブグループや、無関係な他のグループには一切干渉しません）
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;

  const targetGroupId = tabGroupMap.get(tabId);
  tabGroupMap.delete(tabId);

  // 閉じられたタブがグループに属していなかった場合は何もしない
  if (!targetGroupId || targetGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  const settings = await getSettings();
  if (!settings.autoUngroupSingle) {
    return;
  }

  // タブがブラウザ上で完全に破棄された後に、その特定グループの残りタブ数を確認
  setTimeout(async () => {
    try {
      const tabsInGroup = await chrome.tabs.query({ groupId: targetGroupId });
      if (tabsInGroup.length === 1) {
        await chrome.tabs.ungroup(tabsInGroup[0].id);
        tabGroupMap.set(tabsInGroup[0].id, chrome.tabGroups.TAB_GROUP_ID_NONE);
      }
    } catch (e) {
      console.debug("Single tab ungroup check error:", e);
    }
  }, 100);
});
