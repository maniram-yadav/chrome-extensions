from pytubefix import YouTube
import os 
import time

# link = 'https://www.youtube.com/shorts/MpnPLiViDI4'
# video = YouTube(link)
# stream = video.streams.get_highest_resolution()
# stream.download()


def read_urls_from_file(filename):
    """Read URLs from a text file"""
    urls = []
    try:
        with open(filename, 'r', encoding='utf-8') as file:
            for line in file:
                url = line.strip()
                if url and not url.startswith('#'):  # Skip empty lines and comments
                    urls.append(url)
        return urls
    except FileNotFoundError:
        print(f"Error: File '{filename}' not found.")
        return []
    except Exception as e:
        print(f"Error reading file: {str(e)}")
        return []


def download_youtube_video(url, output_path='downloads',video_number=1,prefix='v'):
    """Download a YouTube video from the given URL"""
    try:
        # Create output directory if it doesn't exist
        if not os.path.exists(output_path):
            os.makedirs(output_path)
            print(f"Created directory: {output_path}")
        
        # Create YouTube object
        yt = YouTube(url)
        
        # Get the highest resolution stream
        stream = yt.streams.get_highest_resolution()
        
        # Get video title for filename (remove invalid characters)
        title = "".join(c for c in yt.title if c.isalnum() or c in (' ', '-', '_')).rstrip()
        filename = f"{prefix}{video_number}-{title}.mp4"
        
        print(f"Downloading: {yt.title}")
        print(f"Duration: {yt.length} seconds")
        print(f"Views: {yt.views}")
        
        # Download the video
        print("Download started...")
        stream.download(output_path=output_path, filename=filename)
        
        print(f"✓ Successfully downloaded: {filename}")
        return True
        
    except Exception as e:
        print(f"✗ Error downloading {url}: {str(e)}")
        return False
    

def main():
    # Configuration
    input_file = 'uefa/uefa-4.txt'  # Change this to your file name
    output_directory = 'youtube_downloads'
    
    print("YouTube Video Downloader")
    print("=" * 50)
    
    # Read URLs from file
    urls = read_urls_from_file(input_file)
    
    if not urls:
        print("No URLs found in the file.")
        return
    
    print(f"Found {len(urls)} URLs in '{input_file}'")
    print("-" * 50)
    
    
    successful_downloads = 0
    failed_downloads = 0
    
    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] Processing: {url}")
        
        if download_youtube_video(url, output_directory,i):
            successful_downloads += 1
        else:
            failed_downloads += 1
        
        time.sleep(1)
    
    # Summary
    print("\n" + "=" * 50)
    print("Download Summary:")
    print(f"Total URLs processed: {len(urls)}")
    print(f"Successful downloads: {successful_downloads}")
    print(f"Failed downloads: {failed_downloads}")
    print(f"Videos saved in: {os.path.abspath(output_directory)}")

if __name__ == "__main__":
    main()

