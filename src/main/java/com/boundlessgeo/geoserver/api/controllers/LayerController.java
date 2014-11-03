/* (c) 2014 Boundless, http://boundlessgeo.com
 * This code is licensed under the GPL 2.0 license.
 */
package com.boundlessgeo.geoserver.api.controllers;

import static org.geoserver.catalog.Predicates.equal;

import java.io.IOException;
import java.io.OutputStream;
import java.net.URL;
import java.util.Date;
import java.util.List;
import java.util.logging.Logger;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.FilenameUtils;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang.WordUtils;
import org.geoserver.catalog.CascadeDeleteVisitor;
import org.geoserver.catalog.Catalog;
import org.geoserver.catalog.CatalogBuilder;
import org.geoserver.catalog.CatalogFactory;
import org.geoserver.catalog.CoverageInfo;
import org.geoserver.catalog.DataStoreInfo;
import org.geoserver.catalog.FeatureTypeInfo;
import org.geoserver.catalog.LayerInfo;
import org.geoserver.catalog.Predicates;
import org.geoserver.catalog.ResourceInfo;
import org.geoserver.catalog.StoreInfo;
import org.geoserver.catalog.StyleHandler;
import org.geoserver.catalog.StyleInfo;
import org.geoserver.catalog.Styles;
import org.geoserver.catalog.WMSLayerInfo;
import org.geoserver.catalog.WorkspaceInfo;
import org.geoserver.catalog.util.CloseableIterator;
import org.geoserver.config.GeoServer;
import org.geoserver.importer.Importer;
import org.geoserver.platform.GeoServerResourceLoader;
import org.geoserver.platform.resource.Paths;
import org.geoserver.platform.resource.Resource;
import org.geoserver.platform.resource.Resource.Type;
import org.geoserver.ysld.YsldHandler;
import org.geotools.data.DataAccess;
import org.geotools.data.FeatureSource;
import org.geotools.feature.NameImpl;
import org.geotools.geometry.jts.ReferencedEnvelope;
import org.geotools.referencing.CRS;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.geotools.styling.ResourceLocator;
import org.geotools.styling.Style;
import org.geotools.styling.StyledLayerDescriptor;
import org.geotools.util.Version;
import org.geotools.util.logging.Logging;
import org.geotools.ysld.Ysld;
import org.opengis.filter.Filter;
import org.opengis.filter.sort.SortBy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.yaml.snakeyaml.error.Mark;
import org.yaml.snakeyaml.error.MarkedYAMLException;

import com.boundlessgeo.geoserver.api.exceptions.BadRequestException;
import com.boundlessgeo.geoserver.api.exceptions.InvalidYsldException;
import com.boundlessgeo.geoserver.api.exceptions.NotFoundException;
import com.boundlessgeo.geoserver.json.JSONArr;
import com.boundlessgeo.geoserver.json.JSONObj;
import com.google.common.io.ByteSource;

@Controller
@RequestMapping("/api/layers")
public class LayerController extends ApiController {

    static Logger LOG = Logging.getLogger(LayerController.class);

    Importer importer;

    @Autowired
    public LayerController(GeoServer geoServer, Importer importer) {
        super(geoServer);
        this.importer = importer;
    }

    @RequestMapping(value="/{wsName}", method = RequestMethod.GET)
    public @ResponseBody
    JSONObj list(@PathVariable String wsName, 
            @RequestParam(value="page", required=false) Integer page,
            @RequestParam(value="count", required=false, defaultValue=""+DEFAULT_PAGESIZE) Integer count,
            @RequestParam(value="sort", required=false) String sort, 
            @RequestParam(value="filter", required=false) String textFilter, 
            HttpServletRequest req) {
        JSONObj obj = new JSONObj();

        Catalog cat = geoServer.getCatalog();

        if ("default".equals(wsName)) {
            WorkspaceInfo def = cat.getDefaultWorkspace();
            if (def != null) {
                wsName = def.getName();
            }
        }
        Filter filter = equal("resource.namespace.prefix", wsName);
        if (textFilter != null) {
            filter = Predicates.and(filter, Predicates.fullTextSearch(textFilter));
        }
        Integer total = cat.count(LayerInfo.class, filter);

        SortBy sortBy = null;
        if (sort != null) {
            String[] sortArr = sort.split(":", 2);
            if (sortArr.length == 2) {
                if (sortArr[1].equals("asc")) {
                    sortBy = Predicates.asc(sortArr[0]);
                } else if (sortArr[1].equals("desc")) {
                    sortBy = Predicates.desc(sortArr[0]);
                } else {
                    throw new BadRequestException("Sort order must be \"asc\" or \"desc\"");
                }
            } else {
                sortBy = Predicates.asc(sortArr[0]);
            }
        }

        obj.put("total", total);
        obj.put("page", page != null ? page : 0);
        obj.put("count", Math.min(total, count != null ? count : total));

        JSONArr arr = obj.putArray("layers");
        try (
            CloseableIterator<LayerInfo> it = cat.list(LayerInfo.class, filter, offset(page, count), count, sortBy);
        ) {
            while (it.hasNext()) {
                IO.layer(arr.addObject(), it.next(), req);
            }
        }

        return obj;
    }

    @RequestMapping(value = "/{wsName}", method = RequestMethod.POST, consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public @ResponseBody JSONObj create(@PathVariable String wsName, @RequestBody JSONObj obj, HttpServletRequest req) {
        Catalog cat = geoServer.getCatalog();

        WorkspaceInfo ws = findWorkspace(wsName, cat);

        String name = obj.str("name");
        if (name == null) {
            throw new BadRequestException("Layer object requires name");
        }
        try {
            @SuppressWarnings("unused")
            LayerInfo l = findLayer(wsName, name, cat);
            throw new BadRequestException("Layer named '" + wsName + ":" + name
                    + "' already exists");
        } catch (NotFoundException good) {
        }

        LayerInfo l = null;
        try {
            if (obj.has("layer")) {
                l = createLayerFromLayer(obj.object("layer"), ws, cat);
            } else if (obj.has("resource")) {
                l = createLayerFromResource(obj.object("resource"), ws, cat);
            } else {
                throw new BadRequestException("Layer create requies from (to create from existing layer) or resource (to create from store data)");
            }
        }
        catch(IOException e) {
            throw new RuntimeException("Failed to create layer: " + e.getMessage(), e);
        }

        // restore name in case it was replaced by duplicate
        l.getResource().setName(name);
        l.setName(name);

        // title
        String title = obj.str("title");
        if (title == null) {
            title = WordUtils.capitalize(name);
        }

        l.getResource().setTitle(title);
        l.setTitle(title);

        // description
        String desc = obj.str("description");
        if (desc != null) {
            l.getResource().setAbstract(desc);
            l.setAbstract(desc);
        }

        Date created = new Date();
        Metadata.created(l, created);

        cat.add(l.getResource());
        cat.add(l);

        Metadata.modified(ws, created);
        cat.save(ws);

        return IO.layer(new JSONObj(), l, req);
    }

    LayerInfo createLayerFromLayer(JSONObj from, WorkspaceInfo ws, Catalog cat) {
        LayerInfo orig = findLayer(ws.getName(), from.str("name"), cat);
        ResourceInfo origResource = orig.getResource();

        CatalogFactory factory = cat.getFactory();

        CatalogBuilder builder = new CatalogBuilder(cat);
        builder.setWorkspace(ws);

        LayerInfo l = factory.createLayer();
        if (origResource instanceof FeatureTypeInfo){
            FeatureTypeInfo resource = (FeatureTypeInfo) origResource;
            FeatureTypeInfo data = factory.createFeatureType();
            builder.updateFeatureType(data, resource);
            l.setResource(data);
        }
        else if (origResource instanceof CoverageInfo){
            CoverageInfo resource = (CoverageInfo) origResource;
            CoverageInfo data = factory.createCoverage();
            builder.updateCoverage( data,  resource);
            l.setResource(data);
        }
        else if (origResource instanceof WMSLayerInfo){
            WMSLayerInfo resource = (WMSLayerInfo) origResource;
            WMSLayerInfo data = factory.createWMSLayer();
            builder.updateWMSLayer( data,  resource);
            l.setResource(data);
        }
        else {
            throw new BadRequestException("Unable to copy layer from " + origResource.getClass().getSimpleName());
        }

        //builder.updateLayer( l, orig );
        return l;
    }

    LayerInfo createLayerFromResource(JSONObj ref, WorkspaceInfo ws, Catalog cat) throws IOException {
        String storeName = ref.str("store");
        String resourceName = ref.str("name");

        StoreInfo store = findStore(ws.getName(), storeName, cat);

        CatalogBuilder builder = new CatalogBuilder(cat);

        if( store instanceof DataStoreInfo){
            DataStoreInfo dataStore = (DataStoreInfo) store;
            builder.setStore(dataStore);

            // create from the resource
            FeatureTypeInfo ft = null;
            try {
                ft = builder.buildFeatureType(new NameImpl(resourceName));
            }
            catch(Exception e) {
                if (e instanceof IOException) {
                    throw (IOException) e;
                }
                else {
                    throw new IOException(e);
                }
            }

            DataAccess data = dataStore.getDataStore(null);

            FeatureSource source = data.getFeatureSource(new NameImpl(resourceName));
            builder.setupBounds(ft, source);

            return builder.buildLayer(ft);
        }
        else {
            throw new UnsupportedOperationException("Copy for non vector layer currently unsupported");
        }
    }

    @RequestMapping(value="/{wsName}/{name}", method = RequestMethod.GET)
    public @ResponseBody JSONObj get(@PathVariable String wsName, @PathVariable String name, HttpServletRequest req) {
        LayerInfo l = findLayer(wsName, name, geoServer.getCatalog());
        return IO.layer(new JSONObj(), l, req);
    }

    @RequestMapping(value="/{wsName}/{name}", method = RequestMethod.DELETE)
    public @ResponseBody void delete(@PathVariable String wsName, @PathVariable String name) throws IOException {
        Catalog cat = geoServer.getCatalog();
        LayerInfo layer = findLayer(wsName, name, cat);
        new CascadeDeleteVisitor(cat).visit(layer);
    }

    @RequestMapping(value="/{wsName}/{name}", method = RequestMethod.PATCH)
    public @ResponseBody JSONObj patch(@PathVariable String wsName, @PathVariable String name, @RequestBody JSONObj obj, HttpServletRequest req) throws IOException {
        Catalog cat = geoServer.getCatalog();
        LayerInfo layer = findLayer(wsName, name, cat);
        return  update(layer, obj,req);
    }

    @RequestMapping(value="/{wsName}/{name}", method = RequestMethod.PUT, consumes = MediaType.APPLICATION_JSON_VALUE)
    public @ResponseBody JSONObj put(@PathVariable String wsName, @PathVariable String name, @RequestBody JSONObj obj, HttpServletRequest req) throws IOException {
        Catalog cat = geoServer.getCatalog();
        LayerInfo layer = findLayer(wsName, name, cat);
        return  update(layer, obj,req);
    }
    
    JSONObj update(LayerInfo layer, JSONObj obj, HttpServletRequest req) {
        ResourceInfo resource = layer.getResource();
        for (String prop : obj.keys()) {
            if ("title".equals(prop)) {
                layer.setTitle(obj.str("title"));
            } else if ("description".equals(prop)) {
                layer.setAbstract(obj.str("description"));
            } else if ("bbox".equals(prop)) {
                JSONObj bbox = obj.object("bbox");
                if (bbox.has("native")) {
                    resource.setNativeBoundingBox(
                        new ReferencedEnvelope(IO.bounds(bbox.object("native")), resource.getCRS()));
                }
                if (bbox.has("lonlat")) {
                    resource.setNativeBoundingBox(
                        new ReferencedEnvelope(IO.bounds(bbox.object("lonlat")), DefaultGeographicCRS.WGS84));
                }
            } else if ("proj".equals(prop)) {
                JSONObj proj = obj.object("proj");
                if (!proj.has("srs")) {
                    throw new BadRequestException("proj property must contain a 'srs' property");
                }
                String srs = proj.str("srs");
                try {
                    CRS.decode(srs);
                } catch (Exception e) {
                    throw new BadRequestException("Unknown spatial reference identifier: " + srs);
                }
                resource.setSRS(srs);
            }
        }

        Metadata.modified(layer, new Date());
        Catalog cat = geoServer.getCatalog();
        cat.save(resource);
        cat.save(layer);
        return IO.layer(new JSONObj(), layer, req);
    }

    @RequestMapping(value="/{wsName}/{name}/style", method = RequestMethod.PUT, consumes = YsldHandler.MIMETYPE)
    public @ResponseBody void style(@RequestBody byte[] rawStyle, @PathVariable String wsName, @PathVariable String name)
        throws IOException {
        // first thing is sanity check on the style content
        List<MarkedYAMLException> errors = Ysld.validate(ByteSource.wrap(rawStyle).openStream());
        if (!errors.isEmpty()) {
            throw new InvalidYsldException(errors);
        }

        Catalog cat = geoServer.getCatalog();
        WorkspaceInfo ws = findWorkspace(wsName, cat);
        LayerInfo l = findLayer(wsName, name, cat);

        StyleInfo s = l.getDefaultStyle();

        if (s == null) {
            // create one
            s = cat.getFactory().createStyle();
            s.setName(findUniqueStyleName(wsName, name, cat));
            s.setFilename(s.getName()+".yaml");
            s.setWorkspace(ws);
        }
        else {
            // we are converting from normal SLD?
            if (!YsldHandler.FORMAT.equalsIgnoreCase(s.getFormat())) {
                // reuse base file name
                String base = FilenameUtils.getBaseName(s.getFilename());
                s.setFilename(base + ".yaml");
            }
         }

        s.setFormat(YsldHandler.FORMAT);
        s.setFormatVersion(new Version("1.0.0"));

        // write out the resource
        OutputStream output = dataDir().style(s).out();
        try {
            try {
                IOUtils.copy(ByteSource.wrap(rawStyle).openStream(), output);
                output.flush();
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }
        finally {
            IOUtils.closeQuietly(output);
        }

        if (s.getId() == null) {
            cat.add(s);
        }
        else {
            cat.save(s);
        }

        Metadata.modified(l, new Date());
        cat.save(l);
    }


    @RequestMapping(value="/{wsName}/{name}/style", method = RequestMethod.GET, produces = YsldHandler.MIMETYPE)
    public @ResponseBody Object style(@PathVariable String wsName, @PathVariable String name)
        throws IOException {
        Catalog cat = geoServer.getCatalog();
        LayerInfo l = findLayer(wsName, name, cat);
        StyleInfo s = l.getDefaultStyle();
        if (s == null) {
            throw new NotFoundException(String.format("Layer %s:%s has no default style", wsName, name));
        }

        // if the style is already stored in ySLD format just pull it directly, otherwise encode the style
        if (YsldHandler.FORMAT.equalsIgnoreCase(s.getFormat())) {
            return dataDir().style(s);
        }
        else {            
            GeoServerResourceLoader rl = cat.getResourceLoader();
            String path;
            if( s.getWorkspace() == null ){
                path = Paths.path("styles",s.getFilename());
            }
            else {
                path = Paths.path("workspaces",s.getWorkspace().getName(),"styles",s.getFilename());
            }
            final Resource r = rl.get(path);
            
            // Similar to s.getStyle() and GeoServerDataDirectory.parsedStyle(s)
            // But avoid resolving external graphics to absolute file references 
            if ( r == null || r.getType() == Type.UNDEFINED ){
                throw new IOException( "No such resource: " + s.getFilename());
            }
            // Force use of unmodified URI, avoiding absolute file references
            ResourceLocator locator = new ResourceLocator(){
                public URL locateResource(String spec) {
                    return null;
                }
            };            
            StyleHandler handler = Styles.handler(s.getFormat());
            StyledLayerDescriptor sld = handler.parse(r, s.getFormatVersion(), locator, null);
            
            final Style style = Styles.style(sld); // extract 1st style
            return Styles.sld(style);              // encode in generated SLD
        }
    }
    
    @ExceptionHandler(InvalidYsldException.class)
    public @ResponseBody JSONObj error(InvalidYsldException e, HttpServletResponse response) {
        response.setStatus(HttpStatus.BAD_REQUEST.value());
        
        JSONObj obj = IO.error(new JSONObj(), e);
        JSONArr errors = obj.putArray("errors");
        for (MarkedYAMLException error : e.errors()) {
            JSONObj err = errors.addObject()
                .put("problem", error.getProblem());
            Mark mark = error.getProblemMark();
            if (mark != null) {
                err.put("line", mark.getLine()).put("column", mark.getColumn());
            }
        }
        return obj;
    }

    String findUniqueStyleName(String wsName, String name, Catalog cat) {
        String tryName = name;
        int i = 0;
        while (i++ < 100) {
            if (cat.getStyleByName(wsName, tryName) == null) {
                return tryName;
            }
            tryName = name + String.valueOf(i);
        }
        throw new RuntimeException("Unable to find unique name for style");
    }
}
