import { useState, useCallback } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import FileUpload from '@cloudscape-design/components/file-upload';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import type { UploadResponse, DocumentType } from '@idp/shared';
import { getAllAcceptedExtensions, getDocumentType, DOCUMENT_TYPE_INFO } from '@idp/shared';
import { uploadDocument } from '../../services/api';

interface DocumentUploadProps {
  onUploadComplete: (doc: UploadResponse) => void;
}

export default function DocumentUpload({ onUploadComplete }: DocumentUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [detectedType, setDetectedType] = useState<DocumentType | null>(null);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress(10);

    try {
      const interval = setInterval(() => {
        setProgress((p) => Math.min(p + 15, 85));
      }, 300);

      const result = await uploadDocument(files[0]);
      clearInterval(interval);
      setProgress(100);
      setUploadResult(result);

      const docType = getDocumentType(files[0].name);
      setDetectedType(docType);

      setTimeout(() => {
        onUploadComplete(result);
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(0);
    } finally {
      setUploading(false);
    }
  }, [files, onUploadComplete]);

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Upload a document (PDF, images, Word, PowerPoint, Excel) to begin intelligent processing"
        >
          Document Upload
        </Header>
      }
    >
      <SpaceBetween size="l">
        <FileUpload
          onChange={({ detail }) => {
            setFiles(detail.value);
            setError(null);
            setUploadResult(null);
            setDetectedType(null);
          }}
          value={files}
          i18nStrings={{
            uploadButtonText: (multiple) => (multiple ? 'Choose files' : 'Choose file'),
            dropzoneText: (multiple) =>
              multiple ? 'Drop files to upload' : 'Drop file to upload',
            removeFileAriaLabel: (fileIndex) => `Remove file ${fileIndex + 1}`,
            limitShowFewer: 'Show fewer files',
            limitShowMore: 'Show more files',
            errorIconAriaLabel: 'Error',
          }}
          accept={getAllAcceptedExtensions().join(',')}
          constraintText={`Accepted formats: ${getAllAcceptedExtensions().join(', ')} • Max 50 MB`}
          showFileSize
          showFileLastModified
          tokenLimit={1}
        />

        {files.length > 0 && !uploadResult && (
          <Button
            variant="primary"
            onClick={handleUpload}
            loading={uploading}
            disabled={uploading}
          >
            Upload and Analyze
          </Button>
        )}

        {uploading && (
          <ProgressBar
            value={progress}
            label="Uploading document"
            description="Processing your document..."
            status="in-progress"
          />
        )}

        {error && (
          <Alert type="error" header="Upload failed">
            {error}
          </Alert>
        )}

        {uploadResult && (
          <Alert type="success" header="Upload successful">
            <ColumnLayout columns={4} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">File name</Box>
                <Box>{uploadResult.fileName}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Document type</Box>
                <Box>{detectedType ? DOCUMENT_TYPE_INFO[detectedType]?.name : 'Unknown'}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">File size</Box>
                <Box>{(uploadResult.fileSize / 1024).toFixed(1)} KB</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Pages</Box>
                <Box>{uploadResult.pageCount}</Box>
              </div>
            </ColumnLayout>
          </Alert>
        )}
      </SpaceBetween>
    </Container>
  );
}
