import React, { useState } from 'react';
import { createDrEvent } from '../api/client';

interface DrEventFormProps {
  onCreated?: () => void;
}

type MessageType = 'success' | 'error' | null;

const DrEventForm: React.FC<DrEventFormProps> = ({ onCreated }) => {
  const [limitKw, setLimitKw] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<MessageType>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const parsedLimit = Number(limitKw);
    const parsedDuration = Number(durationMinutes);

    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      setMessage('Please enter a positive limit in kW.');
      setMessageType('error');
      return;
    }

    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setMessage('Please enter a positive duration in minutes.');
      setMessageType('error');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setMessageType(null);

    try {
      const eventResponse = await createDrEvent({
        limitKw: parsedLimit,
        durationMinutes: parsedDuration,
      });

      setMessage(
        `DR event created: limit ${eventResponse.limit_kw} kW from ${eventResponse.ts_start} to ${eventResponse.ts_end}`
      );
      setMessageType('success');
      setLimitKw('');
      setDurationMinutes('');
      onCreated?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create DR event.';
      setMessage(errorMessage);
      setMessageType('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card dr-form">
      <h2>Create DR Event</h2>
      <form onSubmit={handleSubmit} className="dr-form__form">
        <label className="dr-form__label">
          <span>Limit (kW)</span>
          <input
            type="number"
            value={limitKw}
            onChange={(e) => setLimitKw(e.target.value)}
            placeholder="3"
            min="0"
            step="0.1"
          />
        </label>

        <label className="dr-form__label">
          <span>Duration (minutes)</span>
          <input
            type="number"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            placeholder="60"
            min="0"
            step="1"
          />
        </label>

        <button type="submit" disabled={isSubmitting} className="dr-form__button">
          {isSubmitting ? 'Creating…' : 'Create Event'}
        </button>
      </form>

      {message && (
        <div className={`dr-form__message ${messageType === 'success' ? 'success' : 'error'}`}>
          {message}
        </div>
      )}
    </div>
  );
};

export default DrEventForm;
