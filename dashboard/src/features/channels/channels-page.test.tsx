import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelForm } from './channels-page';

describe('ChannelForm', () => {
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
});

