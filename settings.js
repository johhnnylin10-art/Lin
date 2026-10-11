// settings.js

let _db;
let _profilePath;
let _userProfile;
let _currentUID;

// Initialize settings dependencies
export function initSettings(db, profilePath, userProfile, currentUID) {
    _db = db;
    _profilePath = profilePath;
    _userProfile = userProfile;
    _currentUID = currentUID;
}

export function openSettings() {
    const p = globalThis.AGUtils.readJSON(globalThis.AGUtils.uidKey("ag_profile_cache", _currentUID), _userProfile) || _userProfile;
    document.getElementById('set-business-name').value = p.businessName || "";
    document.getElementById('set-business-tagline').value = p.tagline || "";
    document.getElementById('settingsModal').style.display = 'flex';
}

export async function saveSettings() {
    const { set, ref } = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js");
    const name = document.getElementById('set-business-name').value;
    const tag = document.getElementById('set-business-tagline').value;
    
    try {
        await set(ref(_db, _profilePath), { businessName: name, tagline: tag });
    } catch (error) {
        AGErrors.report("profile settings save", error, message => alert(`Profile save failed: ${message}`));
        return;
    }
    
    // Update local cache
    const updatedProfile = { businessName: name, tagline: tag };
    globalThis.AGUtils.writeJSON(globalThis.AGUtils.uidKey("ag_profile_cache", _currentUID), updatedProfile);
    
    document.getElementById('settingsModal').style.display = 'none';
    alert("Profile Updated Successfully");
}
