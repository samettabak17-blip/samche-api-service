import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelForm } from './channels-page';

describe('ChannelForm', () => {
  afterEach(() => cleanup());

  it('hides write controls from AGENT users', () => {
    render(<ChannelForm canManage={false} assistants={[]} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /create channel|save/i })).toBeNull();
  });

  it('validates the display name before a channel request', () => {
    const onSubmit = vi.fn();
    render(<ChannelForm canManage assistants={[]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /create channel/i }));
    expect(screen.getByText('Display name is required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('only exposes Web Chat and WhatsApp in ChannelForm for new channel creation', () => {
    render(<ChannelForm canManage assistants={[]} onSubmit={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Channel type' });
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['WEB_CHAT', 'WHATSAPP']);
  });
});
