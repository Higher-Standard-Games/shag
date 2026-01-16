/**
 * WeaponCommand - Console commands for weapon system
 * 
 * Commands:
 * - weapon load <name> [pk3path] - Load a weapon model
 * - weapon pos <x> <y> <z>       - Adjust weapon offset
 * - weapon scale <n>             - Adjust weapon scale
 * - weapon preset <hip|ads|lowered> - Use position preset
 * - weapon clear                 - Remove current weapon
 * - weapon info                  - Show current weapon info
 */

import { Command, CommandDef } from '../Command';
import { getWeaponViewManager } from '../../weapon/WeaponViewManager';

export default class WeaponCommand extends Command {
    readonly definition: CommandDef = {
        name: 'weapon',
        description: 'Weapon system commands',
        usage: 'weapon <subcommand> [args]',
        subcommands: [
            {
                name: 'load', description: 'Load weapon model', args: [
                    { name: 'name', type: 'string', required: true },
                    { name: 'pk3path', type: 'string', required: false },
                ]
            },
            {
                name: 'pos', description: 'Set position offset', args: [
                    { name: 'x', type: 'number', required: true },
                    { name: 'y', type: 'number', required: true },
                    { name: 'z', type: 'number', required: true },
                ]
            },
            {
                name: 'scale', description: 'Set weapon scale', args: [
                    { name: 'scale', type: 'number', required: true },
                ]
            },
            {
                name: 'preset', description: 'Use position preset', args: [
                    { name: 'preset', type: 'enum', required: true, options: ['hip', 'ads', 'lowered'] },
                ]
            },
            { name: 'clear', description: 'Remove current weapon' },
            { name: 'info', description: 'Show current weapon info' },
            { name: 'hide', description: 'Hide weapon model' },
            { name: 'show', description: 'Show weapon model' },
        ],
    };

    async execute(args: string[]): Promise<string | void> {
        const subcommand = args[0]?.toLowerCase();

        switch (subcommand) {
            case 'load':
                return this.loadWeapon(args.slice(1));
            case 'pos':
            case 'offset':
                return this.setOffset(args.slice(1));
            case 'scale':
                return this.setScale(args.slice(1));
            case 'preset':
                return this.setPreset(args.slice(1));
            case 'clear':
                getWeaponViewManager().clear();
                return 'Weapon cleared';
            case 'info':
                return this.showInfo();
            case 'hide':
                getWeaponViewManager().setVisible(false);
                return 'Weapon hidden';
            case 'show':
                getWeaponViewManager().setVisible(true);
                return 'Weapon visible';
            case 'debug':
                getWeaponViewManager().enableDebug(args[1] !== '0');
                return `Debug ${args[1] !== '0' ? 'enabled' : 'disabled'}`;
            default:
                return this.getHelp();
        }
    }

    private async loadWeapon(args: string[]): Promise<string> {
        const weaponName = args[0];
        if (!weaponName) {
            return 'Usage: weapon load <name> [pk3path]';
        }

        const pk3Path = args[1] || 'games/default/basewsw/data0_15pure.pk3';

        const wvm = getWeaponViewManager();
        const success = await wvm.loadWeapon(weaponName, pk3Path);

        if (success) {
            const info = wvm.getWeaponInfo();
            return `Loaded weapon: ${weaponName}\nSurfaces: ${info?.surfaces}, Frames: ${info?.frames}`;
        }

        return `Failed to load weapon: ${weaponName}`;
    }

    private setOffset(args: string[]): string {
        if (args.length < 3) {
            return 'Usage: weapon pos <x> <y> <z>';
        }

        const x = parseFloat(args[0]);
        const y = parseFloat(args[1]);
        const z = parseFloat(args[2]);

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return 'Invalid coordinates';
        }

        getWeaponViewManager().setOffset(x, y, z);
        return `Weapon offset: (${x}, ${y}, ${z})`;
    }

    private setScale(args: string[]): string {
        if (args.length < 1) {
            return 'Usage: weapon scale <n>';
        }

        const scale = parseFloat(args[0]);
        if (isNaN(scale) || scale <= 0) {
            return 'Invalid scale value';
        }

        getWeaponViewManager().setScale(scale);
        return `Weapon scale: ${scale}`;
    }

    private setPreset(args: string[]): string {
        const preset = args[0]?.toLowerCase();
        if (!preset || !['hip', 'ads', 'lowered'].includes(preset)) {
            return 'Usage: weapon preset <hip|ads|lowered>';
        }

        getWeaponViewManager().setPosition(preset as 'hip' | 'ads' | 'lowered');
        return `Weapon preset: ${preset}`;
    }

    private showInfo(): string {
        const info = getWeaponViewManager().getWeaponInfo();
        if (!info) {
            return 'No weapon loaded';
        }

        return `Weapon: ${info.name}\nSurfaces: ${info.surfaces}\nFrames: ${info.frames}`;
    }
}
