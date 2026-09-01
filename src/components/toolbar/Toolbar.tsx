import React from 'react';
import { MenuBar } from './MenuBar';
import { ToolSubheader } from './ToolSubheader';

export const Toolbar: React.FC = () => {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <MenuBar />
      <ToolSubheader />
    </header>
  );
};
