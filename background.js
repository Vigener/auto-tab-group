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

// ==========================================
// グループのタブ数トラッキング（session storage）
// ==========================================
// Service Worker のスリープ・再起動にも耐えるよう chrome.storage.session に保持
async function getGroupCounts() {
  try {
    const data = await chrome.storage.session.get({ groupCounts: {} });
    return data.groupCounts || {};
  } catch (e) {
    return {};
  }
}

async function saveGroupCounts(counts) {
  try {
    await chrome.storage.session.set({ groupCounts: counts });
  } catch (e) {
    console.debug("Failed to save group counts:", e);
  }
}

// 全グループのタブ数を最新化して保存
async function updateAllGroupCounts() {
  try {
    const groups = await chrome.tabGroups.query({});
    const counts = await getGroupCounts();
    const currentGroupIds = new Set();

    for (const group of groups) {
      currentGroupIds.add(String(group.id));
      const tabs = await chrome.tabs.query({ groupId: group.id });
      counts[String(group.id)] = tabs.length;
    }

    // 存在しなくなったグループを削除
    for (const id in counts) {
      if (!currentGroupIds.has(id)) {
        delete counts[id];
      }
    }

    await saveGroupCounts(counts);
  } catch (e) {
    console.debug("Update group counts error:", e);
  }
}

// 起動時に同期
updateAllGroupCounts();

// グループ作成・更新・削除イベント
chrome.tabGroups.onCreated.addListener(() => updateAllGroupCounts());
chrome.tabGroups.onRemoved.addListener((group) => {
  getGroupCounts().then((counts) => {
    delete counts[String(group.id)];
    saveGroupCounts(counts);
  });
});

// タブのグループ変更（手動グループ化、ドラッグ移動等）
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.groupId !== undefined) {
    updateAllGroupCounts();
  }
});

// ==========================================
// 1. リンククリックによる子タブ生成（グループ化）
// ==========================================
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
    }

    // タブ数を更新
    await updateAllGroupCounts();
  } catch (error) {
    console.debug("Auto Tab Group navigation target error:", error);
  }
});

// ==========================================
// 2. タブが閉じられたときの 1タブグループ解除
// ==========================================
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;

  const settings = await getSettings();
  if (!settings.autoUngroupSingle) {
    return;
  }

  try {
    const counts = await getGroupCounts();
    const groups = await chrome.tabGroups.query({ windowId: removeInfo.windowId });

    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      const currentCount = tabs.length;
      const oldCount = counts[String(group.id)] || 0;

      // 「直前まで2個以上あった」かつ「現在1個になった」場合のみグループを解除
      if (oldCount >= 2 && currentCount === 1) {
        await chrome.tabs.ungroup(tabs[0].id);
        delete counts[String(group.id)];
      } else {
        counts[String(group.id)] = currentCount;
      }
    }

    await saveGroupCounts(counts);
  } catch (error) {
    console.debug("Error during tab onRemoved check:", error);
  }
});
