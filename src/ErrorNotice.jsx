import React from 'react';

export default function ErrorNotice({ message }) {
  return message && <p className="error" role="alert">{message}</p>;
}
