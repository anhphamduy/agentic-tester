import { useState, useCallback, useRef } from "react";
import { ArtifactVersion, VersionManager } from "@/types/version";

interface ArtifactData {
  requirements: any[];
  viewpoints: any[];
  testCases: any[];
}

export function useVersionManager(initialData: ArtifactData) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  const lastSavedData = useRef<ArtifactData>(initialData);

  const generateVersionDescription = useCallback((
    command?: string,
    artifactType?: string,
    changesSummary?: string[]
  ): string => {
    if (command) {
      switch (command) {
        case '/sample':
          return 'Generated Sample Test Cases';
        case '/viewpoints':
          return 'Generated Testing Viewpoints';
        case '/requirements':
          return 'Generated Requirements';
        default:
          if (command.includes('ARTIFACT_SELECTION')) {
            return 'Generated Selected Artifacts';
          }
          return 'AI Generated Updates';
      }
    }
    
    if (artifactType && changesSummary?.length) {
      const count = changesSummary.length;
      return `Updated ${count} ${artifactType}${count > 1 ? 's' : ''}`;
    }
    
    return 'Manual Updates';
  }, []);

  const createVersion = useCallback((
    data: ArtifactData,
    description?: string,
    isAutoSave = false,
    command?: string,
    artifactType?: string
  ): ArtifactVersion => {
    const changesSummary = detectChanges(lastSavedData.current, data);
    const versionDescription = description || generateVersionDescription(command, artifactType, changesSummary);
    
    const newVersion: ArtifactVersion = {
      id: `version-${Date.now()}`,
      versionNumber: versions.length + 1,
      timestamp: new Date(),
      description: versionDescription,
      author: isAutoSave ? 'AI Assistant' : 'User',
      artifactType: 'requirement',
      artifactId: 'suite',
      snapshot: JSON.parse(JSON.stringify(data)),
      changesSummary,
      isAutoSave,
    };

    return newVersion;
  }, [versions.length, generateVersionDescription]);

  const saveVersion = useCallback(
    (data: ArtifactData, description?: string, command?: string, artifactType?: string) => {
      const version = createVersion(data, description, false, command, artifactType);
      setVersions((prev) => [...prev, version]);
      setCurrentVersion(version.versionNumber);
      setHasUnsavedChanges(false);
      lastSavedData.current = JSON.parse(JSON.stringify(data));
      return version;
    },
    [createVersion]
  );

  const autoSaveVersion = useCallback(
    (data: ArtifactData, command?: string, artifactType?: string) => {
      const version = createVersion(data, undefined, true, command, artifactType);
      setVersions((prev) => [...prev, version]);
      setCurrentVersion(version.versionNumber);
      setHasUnsavedChanges(false);
      lastSavedData.current = JSON.parse(JSON.stringify(data));
      return version;
    },
    [createVersion]
  );

  const restoreVersion = useCallback(
    (version: ArtifactVersion, onRestore: (data: ArtifactData) => void) => {
      onRestore(version.snapshot);
      setCurrentVersion(version.versionNumber);
      setHasUnsavedChanges(false);
      lastSavedData.current = JSON.parse(JSON.stringify(version.snapshot));
    },
    []
  );

  const markUnsavedChanges = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  const autoSave = useCallback((data: ArtifactData) => {
    if (hasUnsavedChanges) {
      const changes = detectChanges(lastSavedData.current, data);
      if (changes.length > 0) {
        const version = createVersion(data, 'Auto-save', true);
        setVersions((prev) => [...prev, version]);
        setCurrentVersion(version.versionNumber);
        setHasUnsavedChanges(false);
        lastSavedData.current = JSON.parse(JSON.stringify(data));
      }
    }
  }, [hasUnsavedChanges, createVersion]);

  const detectChanges = useCallback((oldData: ArtifactData, newData: ArtifactData): string[] => {
    const changes: string[] = [];

    const reqChanges = compareArrays(oldData.requirements, newData.requirements, 'requirement');
    changes.push(...reqChanges);

    const viewpointChanges = compareArrays(oldData.viewpoints, newData.viewpoints, 'viewpoint');
    changes.push(...viewpointChanges);

    const testCaseChanges = compareArrays(oldData.testCases, newData.testCases, 'testcase');
    changes.push(...testCaseChanges);

    return changes;
  }, []);

  const compareArrays = useCallback((oldArray: any[], newArray: any[], type: string): string[] => {
    const changes: string[] = [];
    
    // Added items
    const added = newArray.filter(newItem => 
      !oldArray.find(oldItem => oldItem.id === newItem.id)
    );
    added.forEach(item => changes.push(`Added ${type}: ${item.title || item.id}`));

    // Removed items
    const removed = oldArray.filter(oldItem =>
      !newArray.find(newItem => newItem.id === oldItem.id)
    );
    removed.forEach(item => changes.push(`Removed ${type}: ${item.title || item.id}`));

    // Modified items
    oldArray.forEach(oldItem => {
      const newItem = newArray.find(item => item.id === oldItem.id);
      if (newItem) {
        const itemChanges = compareObjects(oldItem, newItem);
        if (itemChanges.length > 0) {
          changes.push(`Modified ${type}: ${newItem.title || newItem.id}`);
        }
      }
    });

    return changes;
  }, []);

  const compareObjects = useCallback((oldObj: any, newObj: any): string[] => {
    const changes: string[] = [];
    const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    keys.forEach(key => {
      if (key === 'lastModified' || key === 'changeHistory') return;
      
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
        changes.push(`${key} updated`);
      }
    });

    return changes;
  }, []);

  return {
    versions,
    currentVersion,
    hasUnsavedChanges,
    saveVersion,
    autoSaveVersion,
    restoreVersion,
    markUnsavedChanges,
    autoSave,
    getLatestVersion: () => versions[versions.length - 1],
  };
}