/**
 * PlayerProfile — Client-side player identity and preferences
 * 
 * UUID v4 identity, display name, keybindings, preferences.
 * Persisted to localStorage for session continuity.
 */

const STORAGE_KEY = 'shag_player_profile';

export interface PlayerProfileData {
    id: string;
    name: string;
    sensitivity: number;
    fov: number;
    crosshairColor: string;
    uiScale: number;
}

export class PlayerProfile {
    readonly id: string;
    name: string;
    sensitivity: number;
    fov: number;
    crosshairColor: string;
    uiScale: number;

    private constructor(data: PlayerProfileData) {
        this.id = data.id;
        this.name = data.name;
        this.sensitivity = data.sensitivity;
        this.fov = data.fov;
        this.crosshairColor = data.crosshairColor;
        this.uiScale = data.uiScale;
    }

    /**
     * Load profile from localStorage, or create a new one with defaults.
     */
    static load(): PlayerProfile {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw) as PlayerProfileData;
                if (data.id && data.name) {
                    return new PlayerProfile(data);
                }
            }
        } catch (e) {
            console.warn('[PlayerProfile] Failed to load profile:', e);
        }

        // Create default profile
        const profile = new PlayerProfile({
            id: generateUUID(),
            name: 'Player',
            sensitivity: 1.0,
            fov: 90,
            crosshairColor: '#ffffff',
            uiScale: 1.0,
        });
        profile.save();
        return profile;
    }

    /**
     * Save current profile to localStorage.
     */
    save(): void {
        const data: PlayerProfileData = {
            id: this.id,
            name: this.name,
            sensitivity: this.sensitivity,
            fov: this.fov,
            crosshairColor: this.crosshairColor,
            uiScale: this.uiScale,
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('[PlayerProfile] Failed to save profile:', e);
        }
    }
}

/** Generate a UUID v4 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
