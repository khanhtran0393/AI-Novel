export type SrtEditorState = {
  open: boolean;
  title: string;
  target: 'original' | 'translated';
  text: string;
};

export type LocalFileKind = 'video' | 'srt' | 'audio' | 'image' | 'png';
