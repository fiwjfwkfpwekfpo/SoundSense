import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFiles, JSON_EXPORT_MAX_BYTES, DIAGNOSTICS_EXPORT_MAX_BYTES, safeJsonFilename, validateJsonExport } from '../../src/platform/files';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('JSON export input', () => {
  it('keeps a safe local basename and JSON extension without path/control characters', () => {
    expect(safeJsonFilename('  Моя палитра.JSON  ')).toBe('Моя палитра.json');
    expect(safeJsonFilename('../folder\\palette\n.json')).toBe('_folder_palette_.json');
    expect(safeJsonFilename('.. .json')).toBe('appearance.json');
    expect(safeJsonFilename('a<>:"|?*.json')).toBe('a_______.json');
  });
  it('bounds UTF-8 filename bytes without splitting Unicode characters', () => {
    const name = safeJsonFilename('🎵'.repeat(100));
    expect(name).toMatch(/\.json$/);
    expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(125);
    expect(name).not.toContain('\ufffd');
  });
  it('accepts valid JSON up to the byte limit and rejects malformed or oversized documents', () => {
    expect(() => validateJsonExport(JSON.stringify({ name: 'Палитра', palette: {} }))).not.toThrow();
    expect(() => validateJsonExport(JSON.stringify('a'.repeat(JSON_EXPORT_MAX_BYTES - 2)))).not.toThrow();
    expect(() => validateJsonExport('{')).toThrow('files.invalidJson');
    expect(() => validateJsonExport(JSON.stringify('a'.repeat(JSON_EXPORT_MAX_BYTES - 1)))).toThrow('files.tooLarge');
    expect(() => validateJsonExport(JSON.stringify('ю'.repeat(JSON_EXPORT_MAX_BYTES / 2)))).toThrow('files.tooLarge');
  });
});

describe('native JSON export dispatch', () => {
  it('saves a diagnostic journal over the palette limit and keeps palette limits unchanged', async () => {
    const saveJson = vi.fn().mockResolvedValue({ status: 'saved' }), files = createFiles(true, { saveJson });
    const text = JSON.stringify({ entries: Array.from({ length: 350 }, (_, id) => ({ id, message: 'Журнал воспроизведения '.repeat(30) })) });
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(JSON_EXPORT_MAX_BYTES);
    await expect(files.saveJson('log.json', text)).rejects.toThrow('files.tooLarge');
    await expect(files.saveJson('log.json', text, 'diagnostics')).resolves.toBe('saved');
    expect(saveJson).toHaveBeenCalledExactlyOnceWith({ filename: 'log.json', text, purpose: 'diagnostics' });
    await expect(files.saveJson('log.json', JSON.stringify('x'.repeat(DIAGNOSTICS_EXPORT_MAX_BYTES)), 'diagnostics')).rejects.toThrow('files.tooLarge');
  });
  it('passes the exact UTF-8 JSON text and a safe name to the native picker', async () => {
    const saveJson = vi.fn().mockResolvedValue({ status: 'saved' });
    const text = JSON.stringify({ name: 'Мои цвета' });
    expect(await createFiles(true, { saveJson }).saveJson('../colors.json', text)).toBe('saved');
    expect(saveJson).toHaveBeenCalledWith({ filename: '_colors.json', text });
  });
  it('returns cancellation normally and leaves native failures as failures', async () => {
    const saveJson = vi.fn().mockResolvedValueOnce({ status: 'cancelled' }).mockRejectedValueOnce(new Error('Provider unavailable'));
    const files = createFiles(true, { saveJson });
    await expect(files.saveJson('colors.json', '{}')).resolves.toBe('cancelled');
    await expect(files.saveJson('colors.json', '{}')).rejects.toThrow('Provider unavailable');
  });
  it('rejects malformed input before opening the picker and validates bridge results', async () => {
    const saveJson = vi.fn().mockResolvedValue({ status: 'unexpected' });
    const files = createFiles(true, { saveJson });
    await expect(files.saveJson('colors.json', '{')).rejects.toThrow('files.invalidJson');
    await expect(files.saveJson('colors.json', JSON.stringify('x'.repeat(JSON_EXPORT_MAX_BYTES)))).rejects.toThrow('files.tooLarge');
    expect(saveJson).not.toHaveBeenCalled();
    await expect(files.saveJson('colors.json', '{}')).rejects.toThrow('files.saveFailed');
  });
});

describe('browser JSON download', () => {
  it('dispatches a JSON Blob download and revokes its object URL', async () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(link), body: { append } });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-json');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const native = { saveJson: vi.fn() };
    const text = JSON.stringify({ name: 'Мои цвета' });
    await expect(createFiles(false, native).saveJson('colors.json', text)).resolves.toBe('saved');
    expect(native.saveJson).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(link);
    expect(link).toMatchObject({ href: 'blob:test-json', download: 'colors.json', hidden: true });
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(await blob.text()).toBe(text);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-json');
  });
  it('cleans up the link and URL if download dispatch throws', async () => {
    vi.useFakeTimers();
    const link = { click: vi.fn(() => { throw new Error('Download blocked'); }), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(link), body: { append: vi.fn() } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-json');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await expect(createFiles(false).saveJson('colors.json', '{}')).rejects.toThrow('Download blocked');
    expect(link.remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-json');
  });
});
