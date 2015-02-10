package org.aksw.facete2.web.main;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.ArrayList;
import java.util.List;

import org.apache.jena.riot.RDFDataMgr;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.hp.hpl.jena.query.Dataset;
import com.hp.hpl.jena.query.DatasetFactory;
import com.hp.hpl.jena.rdf.model.Model;
import com.hp.hpl.jena.rdf.model.ModelFactory;


public class DatasetFromWatchedFolder
    implements Runnable
{
    private static final Logger logger = LoggerFactory.getLogger(DatasetFromWatchedFolder.class);

    private volatile boolean cancelled = false;

    public void cancel() {
        this.cancelled = true;
    }

    public Dataset getDataset() {
        return dataset;
    }

    public static DatasetFromWatchedFolder create(String basePathStr) {
        Path basePath = FileSystems.getDefault().getPath(basePathStr);
        DatasetFromWatchedFolder result = create(basePath);
        return result;
    }

    public static DatasetFromWatchedFolder create(Path basePath) {
        DatasetFromWatchedFolder result = new DatasetFromWatchedFolder(basePath);
        return result;
    }

    public DatasetFromWatchedFolder(Path basePath) {
        this(basePath, DatasetFactory.createMem());
    }

    public DatasetFromWatchedFolder(Path basePath, Dataset dataset) {
        this.basePath = basePath;
        this.dataset = dataset;
    }

    private Dataset dataset;
    private Path basePath;


    public static List<Path> listFilePaths(Path basePath) throws Exception {
        List<Path> result = new ArrayList<Path>();

        DirectoryStream<Path> directoryStream = null;

        try {
            directoryStream = Files.newDirectoryStream(basePath);

            for (Path path : directoryStream) {
                result.add(path);
            }
        } catch (Exception e) {
            if(directoryStream != null) {
                try {
                    directoryStream.close();
                } catch (IOException ex) {
                    throw ex;
                }
            }
            throw e;
        }

        return result;
    }

    public void init() throws Exception {


        List<Path> paths = listFilePaths(basePath);

        for(Path path : paths) {
            processAdd(path);
        }
    }

    public static String getUri(Path fullPath) {
        String result = fullPath.toAbsolutePath().normalize().toUri().toString();
        return result;
    }

    public void processDelete(Path fullPath) {
        String uri = getUri(fullPath);

        // Regardless of the exact event type, remove the data first
        dataset.removeNamedModel(uri);
    }

    public void processAdd(Path fullPath) {
        String uri = getUri(fullPath);
        Model model = ModelFactory.createDefaultModel();
        try {

            logger.debug("Attempting to read file " + uri);
            RDFDataMgr.read(model, uri);

            dataset.addNamedModel(uri, model);
        } catch(Exception e) {
            logger.warn("Failed to read file", e);
        }
    }

    public static void main(String[] args) throws Exception {

    }

    @Override
    public void run() {
        //Map<String, String> fileToGraph = new HashMap<String, String>();

        //Path basePath = FileSystems.getDefault().getPath(dataPathStr);

        WatchKey watchKey;
        WatchService watchService;
        try {
            watchService = FileSystems.getDefault().newWatchService();

            watchKey = basePath.register(watchService,
                    StandardWatchEventKinds.ENTRY_CREATE,
                    StandardWatchEventKinds.ENTRY_DELETE,
                    StandardWatchEventKinds.ENTRY_MODIFY);
        } catch (IOException e1) {
            throw new RuntimeException(e1);
        }


        //dataset.addNamedModel(uri, model);

        while (!cancelled) {
            //WatchKey watchKey;
            try {
                watchKey = watchService.take();
            } catch (InterruptedException e) {
                continue;
            }

            for (WatchEvent<?> event : watchKey.pollEvents()) {
                // We only register "ENTRY_MODIFY" so the context is always a Path.
                Path changedPath = (Path)event.context();
                Path fullPath = basePath.resolve(changedPath);

                // Filter out hidden files, such as generated by vim
                String fileName = fullPath.getFileName().toString();
                if(fileName.startsWith(".")) {
                    logger.debug("Ignored processing changes of hidden file: " + fileName);
                    continue;
                }

                processDelete(fullPath);

                Object eventKind = event.kind();

                if(!eventKind.equals(StandardWatchEventKinds.ENTRY_DELETE)) {
                    processAdd(fullPath);
                }
            }
            watchKey.reset();
        }
    }
}


