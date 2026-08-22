import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeDocumentForm } from './knowledge-base-page';

describe('KnowledgeDocumentForm', () => {
  it('does not render write controls for an AGENT', () => {
    render(<KnowledgeDocumentForm canManage={false} assistants={[]} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /create document|save/i })).toBeNull();
  });

  it('requires title and text content before submission', () => {
    const onSubmit = vi.fn();
    render(<KnowledgeDocumentForm canManage assistants={[]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /create document/i }));
    expect(screen.getByText('Title and content are required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

