import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelForm, WhatsAppOwnershipConflictPanel } from './channels-page';

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

  it('assigns the first eligible active tenant assistant when configuring WhatsApp', () => {
    const onSubmit = vi.fn();
    render(<ChannelForm canManage assistants={[
      { id: 'inactive-assistant', tenant_id: 'tenant-a', name: 'Inactive', status: 'inactive' },
      { id: 'active-assistant', tenant_id: 'tenant-a', name: 'Active Assistant', status: 'active' },
    ]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Channel type' }), { target: { value: 'WHATSAPP' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'Customer WhatsApp' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'External channel ID' }), { target: { value: '948536645017374' } });

    const assistant = screen.getByRole('combobox', { name: 'Assigned assistant' }) as HTMLSelectElement;
    expect(assistant.value).toBe('active-assistant');
    expect(within(assistant).queryByRole('option', { name: 'Inactive' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      channel_type: 'WHATSAPP',
      assistant_id: 'active-assistant',
      status: 'active',
    }));
  });

  it('blocks an active WhatsApp channel when no eligible assistant exists', () => {
    const onSubmit = vi.fn();
    render(<ChannelForm canManage assistants={[]} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Channel type' }), { target: { value: 'WHATSAPP' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'Customer WhatsApp' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'External channel ID' }), { target: { value: '948536645017374' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create channel' }));

    expect(screen.getByRole('alert').textContent).toContain('active assistant');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('WhatsAppOwnershipConflictPanel', () => {
  afterEach(() => cleanup());

  it('explains the structured conflict but gives an ordinary tenant administrator no transfer action', () => {
    render(<WhatsAppOwnershipConflictPanel
      isPlatformOwner={false}
      conflict={{ ownership: 'OTHER_TENANT', external_channel_id: '948536645017374', transfer_required: true }}
      onTransfer={vi.fn()}
      isPending={false}
    />);
    expect(screen.getByRole('alert').textContent).toContain('another tenant');
    expect(screen.queryByRole('button', { name: /transfer/i })).toBeNull();
  });

  it('requires explicit confirmation before a platform owner can transfer', () => {
    const onTransfer = vi.fn();
    render(<WhatsAppOwnershipConflictPanel
      isPlatformOwner
      conflict={{
        ownership: 'OTHER_TENANT',
        external_channel_id: '948536645017374',
        transfer_required: true,
        source_channel_id: 'source-channel',
        source_tenant_id: 'source-tenant',
        platform_transfer_available: true,
      }}
      onTransfer={onTransfer}
      isPending={false}
    />);
    const button = screen.getByRole('button', { name: /transfer channel/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm cross-tenant transfer/i }));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onTransfer).toHaveBeenCalledTimes(1);
  });
});
