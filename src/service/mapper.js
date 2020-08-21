"use strict"

const Jimp = require('jimp');

/**
 * Mapper service
 */
class Mapper
{
    /**
     * Use Mapper to make image maps
     * @param {String} country Country ISO3 code
     */
    constructor(country)
    {
        /**
         * GADM API URI: \
         * `https://gadm.org/img/480/gadm`
         */
        this.gadm = 'https://gadm.org/img/480/gadm';

        this.setCountry(country);
    }

    /**
     * Set the mapper country code
     * @param {String} country Country ISO3 code 
     * @returns {Self}
     */
    setCountry(country)
    {
        this.country = country;
        this.image = this.gadm + '/' + country + '/' + country + '.png';

        return this;
    }

    /**
     * Obtain an image map from GADM
     * @returns {Jimp}
     */
    async fetchGADM()
    {
        return Jimp.read(this.image)
            .then(map => {
                return map;
            })
            .catch(err => {
                console.log(err);
            });
    }

    /**
     * Get area of country from REST countries
     * @param {String} country Country ISO3 code to be fetched 
     * @returns {Number}
     */
    async fetchCountryArea(country = this.country)
    {
        let Country = require('./country'),
            data = new Country();
            country = await data.getByCode(country);

        return country.area;
    }

    /**
     * FInd the relation of current map country area to pixels
     * @return {Promise} Square kilometers per pixel in map
     */
    async kilometersToPixels()
    {
        let countPixels = require('count-pixels');
        
        let pixelCount = await countPixels(this.image);
        let countryPixels = pixelCount['#d3d3d3'];
        let countryKilometers = await this.fetchCountryArea();

        return new Promise((resolve, reject) => {
            resolve({
                pixels: countryPixels,
                kilometers: countryKilometers,
                ppkm:  countryPixels / countryKilometers
            });
        });
    }

    /**
     * Replace the pixels on the map with deforestaded pixels
     * @param {Mapper} map Mapper instance
     * @param {Number} area Deforestated area
     * @param {String} color Deforestated area color
     * @param {String} landColor Land color
     * @returns {Jimp}
     */
    async paintArea(map, area, color = '#f60b2a', landColor = '#D3D3D3')
    {
        let km = await map.kilometersToPixels(),
            image = await map.fetchGADM();

        let paintArea = area * km.ppkm,
            land = Jimp.cssColorToHex(landColor),
            hexCode = Jimp.cssColorToHex(color),
            x = 0,
            y = 0;

        // Parse image top to bottom
        while (image.bitmap.height >= y) {
            // Paint land pixels
            let pixel = image.getPixelColor(x, y);
            if (pixel == land && paintArea > 0) {
                image.setPixelColor(hexCode, x, y);
                paintArea -= 1;
            }

            // Move to the next column
            if (image.bitmap.height == y && image.bitmap.width > x) {
                x++;
                y = 0;
            // or to the next pixel
            } else {
                y++;
            }
        }

        return image;
    }
}

module.exports = Mapper;
