import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantForm } from './assistants-page';

afterEach(cleanup);

describe('AssistantForm', () => {
  it('does not render write controls for an AGENT', () => {
    render(<AssistantForm canManage={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /save|create/i })).toBeNull();
  });

  it('validates a blank assistant name before submitting', () => {
    const onSubmit = vi.fn();
    render(<AssistantForm canManage onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /create assistant/i }));
    expect(screen.getByText('Assistant name is required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not expose platform model selection in a customer assistant form', () => {
    render(<AssistantForm canManage isOwner={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: 'Model' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'System prompt' })).toBeNull();
  });

  it('does not submit a raw system prompt from a customer assistant form', () => {
    const onSubmit = vi.fn();
    render(<AssistantForm canManage isOwner={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Assistant name' }), { target: { value: 'Customer-safe assistant' } });
    fireEvent.click(screen.getByRole('button', { name: /create assistant/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Customer-safe assistant', status: 'active' });
  });

  it('keeps platform model selection available to an owner', () => {
    render(<AssistantForm canManage isOwner onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Model' })).toBeTruthy();
  });
});

